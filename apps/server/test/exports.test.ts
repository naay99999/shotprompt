import { describe, expect, it } from 'bun:test'
import { exportsTable, jobs } from '@shotprompt/db'
import { createTestApp } from './helpers/app'
import { createClip, createExport, createReadyVideo } from './helpers/fixtures'

function makeApp() {
  const result = createTestApp()
  createReadyVideo(result.db, { width: 1920, height: 1080 })
  createClip(result.db)
  return result
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
  createExport(db)
  const res = await app.handle(new Request('http://x/exports/e1/download'))
  expect(res.status).toBe(409)
})

it('GET /videos/:id/exports lists exports for the video\'s clips, newest first', async () => {
  const { app, db } = makeApp()
  createExport(db, { status: 'done' })
  createExport(db, { id: 'e2', aspect: '16:9', burnSubtitles: true, createdAt: 2 })
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
