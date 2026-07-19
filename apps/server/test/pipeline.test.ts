import { describe, expect, it } from 'bun:test'
import { createDb, jobs, jobSteps, videos } from '@shotprompt/db'
import { eq } from 'drizzle-orm'
import { makePipelineRunner, PIPELINE_STEPS } from '../src/pipeline'

// makePipelineRunner accepts an optional steps map for tests
it('runs steps in order, skips satisfied ones, marks video ready', async () => {
  const db = createDb(':memory:')
  db.insert(videos).values({ id: 'v1', filename: 'a.mp4', path: '/x', status: 'processing', language: 'th', createdAt: 1 }).run()
  db.insert(jobs).values({ id: 'j1', videoId: 'v1', type: 'pipeline', status: 'queued', createdAt: 1 }).run()
  const ran: string[] = []
  const fake = Object.fromEntries(PIPELINE_STEPS.map(name => [name, {
    run: async () => { ran.push(name) },
    satisfied: () => name === 'normalize', // pretend normalize already done
  }]))
  const runner = makePipelineRunner(db, fake as any)
  await runner('j1', { signal: new AbortController().signal, setChild: () => {} })
  expect(ran).toEqual(PIPELINE_STEPS.filter(s => s !== 'normalize'))
  expect(db.select().from(videos).where(eq(videos.id, 'v1')).get()!.status).toBe('ready')
  expect(db.select().from(jobSteps).all().every(s => s.status === 'done')).toBe(true)
})

it('marks video failed and rethrows on step error', async () => {
  const db = createDb(':memory:')
  db.insert(videos).values({ id: 'v1', filename: 'a.mp4', path: '/x', status: 'processing', language: 'th', createdAt: 1 }).run()
  db.insert(jobs).values({ id: 'j1', videoId: 'v1', type: 'pipeline', status: 'queued', createdAt: 1 }).run()
  const fake = Object.fromEntries(PIPELINE_STEPS.map(name => [name, {
    run: async () => { if (name === 'transcribe') throw new Error('whisper died') },
    satisfied: () => false,
  }]))
  const runner = makePipelineRunner(db, fake as any)
  await expect(runner('j1', { signal: new AbortController().signal, setChild: () => {} })).rejects.toThrow('whisper died')
  expect(db.select().from(videos).where(eq(videos.id, 'v1')).get()!.status).toBe('failed')
})
