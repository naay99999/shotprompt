import { describe, expect, it } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { candidates, clipSubtitles, clips, exportsTable, jobs, scenes, segments } from '@shotprompt/db'
import { createTestApp } from './helpers/app'
import { createJob, createReadyVideo } from './helpers/fixtures'

function makeApp() {
  return createTestApp()
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
    createReadyVideo(db, { status: 'processing' })
    createJob(db, { status: 'running' })
    const res = await app.handle(new Request('http://x/videos/v1', { method: 'DELETE' }))
    expect(res.status).toBe(409)
  })
  it('stream honors Range', async () => {
    const { app, db } = makeApp()
    const dir = mkdtempSync(join(tmpdir(), 'sp-'))
    const src = join(dir, 'source.mp4'); writeFileSync(src, '0123456789')
    createReadyVideo(db, { path: src })
    const res = await app.handle(new Request('http://x/videos/v1/stream', { headers: { range: 'bytes=2-5' } }))
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(await res.text()).toBe('2345')
  })
  it('repairs derived data without touching user clips, subtitles, or exports', async () => {
    const { app, db } = makeApp()
    createReadyVideo(db, { duration: 40 })
    db.insert(segments).values({ videoId: 'v1', start: 0, end: 2, text: 'old auto subtitle' }).run()
    db.insert(scenes).values({ videoId: 'v1', time: 1 }).run()
    db.insert(candidates).values({ id: 'c1', videoId: 'v1', start: 0, end: 5, score: 40 }).run()
    db.insert(clips).values({ id: 'cl1', videoId: 'v1', start: 0, end: 5, cropOffset: 0, createdAt: 1 }).run()
    db.insert(clipSubtitles).values({ clipId: 'cl1', start: 0, end: 2, text: 'edited subtitle' }).run()
    db.insert(exportsTable).values({ id: 'e1', clipId: 'cl1', aspect: '9:16', burnSubtitles: false, status: 'done', createdAt: 1 }).run()

    const res = await app.handle(new Request('http://x/videos/v1/repair', { method: 'POST' }))

    expect(res.status).toBe(200)
    expect(db.select().from(segments).all()).toEqual([])
    expect(db.select().from(scenes).all()).toEqual([])
    expect(db.select().from(candidates).all()).toEqual([])
    expect(db.select().from(clipSubtitles).all().map(row => row.text)).toEqual(['edited subtitle'])
    expect(db.select().from(exportsTable).all().map(row => row.id)).toEqual(['e1'])
    expect(db.select().from(jobs).all().filter(job => job.type === 'pipeline')).toHaveLength(1)
  })
  it('refuses repair while a pipeline job is active', async () => {
    const { app, db } = makeApp()
    createReadyVideo(db, { duration: 40 })
    createJob(db, { status: 'running' })
    const res = await app.handle(new Request('http://x/videos/v1/repair', { method: 'POST' }))
    expect(res.status).toBe(409)
  })
  it('retries from a clean transcription pipeline', async () => {
    const { app, db } = makeApp()
    createReadyVideo(db, { duration: 40 })
    db.insert(segments).values({ videoId: 'v1', start: 0, end: 2, text: 'old auto subtitle' }).run()
    db.insert(candidates).values({ id: 'c1', videoId: 'v1', start: 0, end: 5, score: 40 }).run()

    const res = await app.handle(new Request('http://x/videos/v1/retry', { method: 'POST' }))

    expect(res.status).toBe(200)
    expect(db.select().from(segments).all()).toEqual([])
    expect(db.select().from(candidates).all()).toEqual([])
    expect(db.select().from(jobs).all().filter(job => job.type === 'pipeline')).toHaveLength(1)
  })
})
