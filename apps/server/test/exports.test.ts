import { describe, expect, it } from 'bun:test'
import { createDb, clips, exportsTable, jobs, videos } from '@shotprompt/db'
import { createApp } from '../src/app'
import { createCtx } from '../src/context'

function makeApp() {
  const db = createDb(':memory:')
  db.insert(videos).values({ id: 'v1', filename: 'a.mp4', path: '/x', status: 'ready', language: 'th', createdAt: 1, width: 1920, height: 1080 }).run()
  db.insert(clips).values({ id: 'cl1', videoId: 'v1', start: 5, end: 20, cropOffset: 0, createdAt: 1 }).run()
  return { app: createApp(createCtx(db, { autoRun: false })), db }
}

it('POST /exports creates one export row per clip and queues jobs', async () => {
  const { app, db } = makeApp()
  const res = await app.handle(new Request('http://x/exports', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clipIds: ['cl1'], aspect: '9:16', burnSubtitles: true }),
  }))
  expect(res.status).toBe(200)
  expect(db.select().from(exportsTable).all()).toHaveLength(1)
  expect(db.select().from(jobs).all().filter(j => j.type === 'export')).toHaveLength(1)
})

it('download 409s while not done', async () => {
  const { app, db } = makeApp()
  db.insert(exportsTable).values({ id: 'e1', clipId: 'cl1', aspect: '9:16', burnSubtitles: false, status: 'queued', createdAt: 1 }).run()
  const res = await app.handle(new Request('http://x/exports/e1/download'))
  expect(res.status).toBe(409)
})

it('GET /videos/:id/exports lists exports for the video\'s clips, newest first', async () => {
  const { app, db } = makeApp()
  db.insert(exportsTable).values({ id: 'e1', clipId: 'cl1', aspect: '9:16', burnSubtitles: false, status: 'done', createdAt: 1 }).run()
  db.insert(exportsTable).values({ id: 'e2', clipId: 'cl1', aspect: '16:9', burnSubtitles: true, status: 'queued', createdAt: 2 }).run()
  const res = await app.handle(new Request('http://x/videos/v1/exports'))
  expect(res.status).toBe(200)
  const rows = await res.json() as { id: string }[]
  expect(rows.map(r => r.id)).toEqual(['e2', 'e1'])
})

it('GET /videos/:id/exports returns an empty array for a video with no clips', async () => {
  const { app } = makeApp()
  const res = await app.handle(new Request('http://x/videos/nope/exports'))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual([])
})
