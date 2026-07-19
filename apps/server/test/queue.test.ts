import { describe, expect, it } from 'bun:test'
import { createDb, jobs, jobSteps } from '@shotprompt/db'
import { eq } from 'drizzle-orm'
import { JobQueue } from '../src/queue'
import { recover } from '../src/recovery'

const mkJob = (db: any, id: string, status = 'queued') =>
  db.insert(jobs).values({ id, videoId: 'v1', type: 'pipeline', status, createdAt: Date.now() }).run()

describe('JobQueue', () => {
  it('runs jobs sequentially and marks done', async () => {
    const db = createDb(':memory:')
    const order: string[] = []
    const q = new JobQueue(db, 'pipeline', async id => { order.push(id) })
    mkJob(db, 'a'); mkJob(db, 'b')
    q.enqueue('a'); q.enqueue('b')
    await q.idle()
    expect(order).toEqual(['a', 'b'])
    expect(db.select().from(jobs).where(eq(jobs.id, 'a')).get()!.status).toBe('done')
  })
  it('marks failed on throw', async () => {
    const db = createDb(':memory:')
    const q = new JobQueue(db, 'pipeline', async () => { throw new Error('boom') })
    mkJob(db, 'a'); q.enqueue('a'); await q.idle()
    const row = db.select().from(jobs).where(eq(jobs.id, 'a')).get()!
    expect(row.status).toBe('failed'); expect(row.error).toBe('boom')
  })
  it('cancel aborts a running job', async () => {
    const db = createDb(':memory:')
    const q = new JobQueue(db, 'pipeline', (id, ctx) => new Promise((_, rej) => {
      ctx.signal.addEventListener('abort', () => rej(new Error('aborted')))
    }))
    mkJob(db, 'a'); q.enqueue('a')
    await Bun.sleep(10)
    expect(q.cancel('a')).toBe(true)
    await q.idle()
    expect(db.select().from(jobs).where(eq(jobs.id, 'a')).get()!.status).toBe('canceled')
  })
})

describe('recover', () => {
  it('fails stale jobs and steps', () => {
    const db = createDb(':memory:')
    mkJob(db, 'a', 'running')
    db.insert(jobSteps).values({ jobId: 'a', name: 'transcribe', status: 'running' }).run()
    recover(db)
    expect(db.select().from(jobs).where(eq(jobs.id, 'a')).get()!.status).toBe('failed')
    expect(db.select().from(jobSteps).all()[0].status).toBe('failed')
  })
})
