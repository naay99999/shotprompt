import { describe, expect, it } from 'bun:test'
import { createDb, jobs, jobSteps, videos, clips, exportsTable } from '@shotprompt/db'
import { eq } from 'drizzle-orm'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { JobQueue } from '../src/queue'
import { recover } from '../src/recovery'
import { DATA_DIR, MODELS_DIR } from '../src/env'

const mkVideo = (db: any, id: string, status: string) =>
  db.insert(videos).values({ id, filename: `${id}.mp4`, path: `/x/${id}`, status, language: 'th', createdAt: 1 }).run()
const mkClip = (db: any, id: string, videoId: string) =>
  db.insert(clips).values({ id, videoId, start: 0, end: 1, cropOffset: 0, createdAt: 1 }).run()
const mkExport = (db: any, id: string, clipId: string, status: string) =>
  db.insert(exportsTable).values({ id, clipId, aspect: '9:16', burnSubtitles: false, status, createdAt: 1 }).run()

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

  it('fails videos stuck in uploaded/processing and exports stuck in queued/rendering', () => {
    const db = createDb(':memory:')
    mkVideo(db, 'v-uploaded', 'uploaded')
    mkVideo(db, 'v-processing', 'processing')
    mkClip(db, 'c1', 'v-processing')
    mkExport(db, 'e-queued', 'c1', 'queued')
    mkExport(db, 'e-rendering', 'c1', 'rendering')
    recover(db)
    expect(db.select().from(videos).where(eq(videos.id, 'v-uploaded')).get()!.status).toBe('failed')
    expect(db.select().from(videos).where(eq(videos.id, 'v-processing')).get()!.status).toBe('failed')
    expect(db.select().from(exportsTable).where(eq(exportsTable.id, 'e-queued')).get()!.status).toBe('failed')
    expect(db.select().from(exportsTable).where(eq(exportsTable.id, 'e-rendering')).get()!.status).toBe('failed')
  })

  it('does not touch videos/exports already in a terminal state', () => {
    const db = createDb(':memory:')
    mkVideo(db, 'v-ready', 'ready')
    mkVideo(db, 'v-failed', 'failed')
    mkClip(db, 'c2', 'v-ready')
    mkExport(db, 'e-done', 'c2', 'done')
    mkExport(db, 'e-failed', 'c2', 'failed')
    recover(db)
    expect(db.select().from(videos).where(eq(videos.id, 'v-ready')).get()!.status).toBe('ready')
    expect(db.select().from(videos).where(eq(videos.id, 'v-failed')).get()!.status).toBe('failed')
    expect(db.select().from(exportsTable).where(eq(exportsTable.id, 'e-done')).get()!.status).toBe('done')
    expect(db.select().from(exportsTable).where(eq(exportsTable.id, 'e-failed')).get()!.status).toBe('failed')
  })

  it('sweeps a pipeline .tmp file but preserves a model-download .tmp.bin under MODELS_DIR', () => {
    const db = createDb(':memory:')
    const videoTmpDir = join(DATA_DIR, 'videos', '__test_recover_sweep__')
    mkdirSync(videoTmpDir, { recursive: true })
    const pipelineTmp = join(videoTmpDir, 'audio.tmp.wav')
    writeFileSync(pipelineTmp, 'x')
    mkdirSync(MODELS_DIR, { recursive: true })
    const modelTmp = join(MODELS_DIR, 'ggml-__test-recover__.tmp.bin')
    writeFileSync(modelTmp, 'x')
    try {
      recover(db)
      expect(existsSync(pipelineTmp)).toBe(false)
      expect(existsSync(modelTmp)).toBe(true)
    } finally {
      rmSync(videoTmpDir, { recursive: true, force: true })
      rmSync(modelTmp, { force: true })
    }
  })
})
