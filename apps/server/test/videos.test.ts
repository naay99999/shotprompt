import { describe, expect, it } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDb, jobs, videos } from '@shotprompt/db'
import { createApp } from '../src/app'
import { createCtx } from '../src/context'

function makeApp() {
  const db = createDb(':memory:')
  const ctx = createCtx(db, { autoRun: false }) // autoRun:false → enqueue records but does not execute (test hook)
  return { app: createApp(ctx), db }
}

describe('videos', () => {
  it('ingests via local path and queues a pipeline job', async () => {
    const { app, db } = makeApp()
    const dir = mkdtempSync(join(tmpdir(), 'sp-'))
    const src = join(dir, 'in.mp4'); writeFileSync(src, 'fake')
    const res = await app.handle(new Request('http://x/videos', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: src, language: 'th' }),
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.video.status).toBe('uploaded')
    expect(db.select().from(jobs).all()).toHaveLength(1)
  })
  it('400 on missing local path', async () => {
    const { app } = makeApp()
    const res = await app.handle(new Request('http://x/videos', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/nope/nothing.mp4', language: 'th' }),
    }))
    expect(res.status).toBe(400)
  })
  it('DELETE refuses while job is active', async () => {
    const { app, db } = makeApp()
    db.insert(videos).values({ id: 'v1', filename: 'a.mp4', path: '/x', status: 'processing', language: 'th', createdAt: 1 }).run()
    db.insert(jobs).values({ id: 'j1', videoId: 'v1', type: 'pipeline', status: 'running', createdAt: 1 }).run()
    const res = await app.handle(new Request('http://x/videos/v1', { method: 'DELETE' }))
    expect(res.status).toBe(409)
  })
  it('stream honors Range', async () => {
    const { app, db } = makeApp()
    const dir = mkdtempSync(join(tmpdir(), 'sp-'))
    const src = join(dir, 'source.mp4'); writeFileSync(src, '0123456789')
    db.insert(videos).values({ id: 'v1', filename: 'a.mp4', path: src, status: 'ready', language: 'th', createdAt: 1 }).run()
    const res = await app.handle(new Request('http://x/videos/v1/stream', { headers: { range: 'bytes=2-5' } }))
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(await res.text()).toBe('2345')
  })
})
