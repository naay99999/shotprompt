import { describe, expect, it } from 'bun:test'
import { createDb, candidates, clipSubtitles, segments, videos } from '@shotprompt/db'
import { eq } from 'drizzle-orm'
import { createClip, updateClip } from '../src/clip-service'
import { createTestApp } from './helpers/app'
import { createClip as createClipFixture, createReadyVideo } from './helpers/fixtures'

function seeded() {
  const db = createDb(':memory:')
  db.insert(videos).values({ id: 'v1', filename: 'a.mp4', path: '/x', duration: 40, status: 'ready', language: 'th', createdAt: 1 }).run()
  db.insert(segments).values([
    { videoId: 'v1', start: 0, end: 5, text: 'a' },
    { videoId: 'v1', start: 10, end: 15, text: 'b' },
    { videoId: 'v1', start: 20, end: 25, text: 'c' },
    { videoId: 'v1', start: 30, end: 35, text: 'd' },
  ]).run()
  db.insert(candidates).values({ id: 'c1', videoId: 'v1', start: 8, end: 26, score: 55, thumbnailPath: '/thumbs/c1.jpg' }).run()
  return db
}

describe('createClip', () => {
  it('from candidate copies range/score and overlapping subtitles', () => {
    const db = seeded()
    const clip = createClip(db, 'v1', { candidateId: 'c1' })
    expect(clip.start).toBe(8); expect(clip.score).toBe(55); expect(clip.candidateId).toBe('c1')
    expect(clip.thumbnailPath).toBe('/thumbs/c1.jpg')
    const subs = db.select().from(clipSubtitles).where(eq(clipSubtitles.clipId, clip.id)).all()
    expect(subs.map(s => s.text)).toEqual(['b', 'c']) // 10-15 & 20-25 overlap [8,26]
  })
  it('manual clip from raw range', () => {
    const db = seeded()
    const clip = createClip(db, 'v1', { start: 28, end: 40 })
    expect(clip.candidateId).toBeNull()
    const subs = db.select().from(clipSubtitles).where(eq(clipSubtitles.clipId, clip.id)).all()
    expect(subs.map(s => s.text)).toEqual(['d'])
  })
  it('rejects a manual range outside the source video', () => {
    const db = seeded()
    expect(() => createClip(db, 'v1', { start: -1, end: 10 })).toThrow('range outside video')
    expect(() => createClip(db, 'v1', { start: 10, end: 41 })).toThrow('range outside video')
  })
  it('rejects a candidate owned by a different video', () => {
    const db = seeded()
    db.insert(videos).values({ id: 'v2', filename: 'b.mp4', path: '/y', duration: 40, status: 'ready', language: 'th', createdAt: 2 }).run()
    expect(() => createClip(db, 'v2', { candidateId: 'c1' })).toThrow('candidate does not belong to video')
  })
})

describe('updateClip trim rules', () => {
  it('extend copies only the new range, never touches edited rows', () => {
    const db = seeded()
    const clip = createClip(db, 'v1', { start: 8, end: 26 })
    db.update(clipSubtitles).set({ text: 'EDITED' }).where(eq(clipSubtitles.clipId, clip.id)).run()
    updateClip(db, clip.id, { start: 8, end: 36 }) // extend end: new range (26,36] → copies 'd'
    const subs = db.select().from(clipSubtitles).where(eq(clipSubtitles.clipId, clip.id)).all()
      .sort((a, b) => a.start - b.start)
    expect(subs.map(s => s.text)).toEqual(['EDITED', 'EDITED', 'd'])
  })
  it('shrink deletes nothing', () => {
    const db = seeded()
    const clip = createClip(db, 'v1', { start: 8, end: 26 })
    updateClip(db, clip.id, { start: 12, end: 22 })
    expect(db.select().from(clipSubtitles).where(eq(clipSubtitles.clipId, clip.id)).all()).toHaveLength(2)
  })
  it('extending a boundary does not duplicate a subtitle row that straddles it', () => {
    const db = seeded()
    // straddles clip.start=8: matched both by the initial [8,26] copy and by the
    // [2,8) range opened up when the start is later extended to 2.
    db.insert(segments).values({ videoId: 'v1', start: 6, end: 12, text: 'straddle' }).run()
    const clip = createClip(db, 'v1', { start: 8, end: 26 })
    updateClip(db, clip.id, { start: 2, end: 26 })
    const straddleRows = db.select().from(clipSubtitles)
      .where(eq(clipSubtitles.clipId, clip.id)).all()
      .filter(s => s.text === 'straddle')
    expect(straddleRows).toHaveLength(1)
  })
  it('rejects an edit outside the source video or crop range', () => {
    const db = seeded()
    const clip = createClip(db, 'v1', { start: 8, end: 26 })
    expect(() => updateClip(db, clip.id, { end: 41 })).toThrow('range outside video')
    expect(() => updateClip(db, clip.id, { cropOffset: 1.1 })).toThrow('invalid crop offset')
  })
})

describe('subtitle replacement', () => {
  it('keeps existing subtitles when a replacement row has an invalid range', async () => {
    const { app, db } = createTestApp()
    createReadyVideo(db, { duration: 40 })
    createClipFixture(db)
    db.insert(clipSubtitles).values({ clipId: 'cl1', start: 5, end: 6, text: 'keep me' }).run()

    const res = await app.handle(new Request('http://x/clips/cl1/subtitles', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subtitles: [{ start: 9, end: 8, text: 'invalid' }] }),
    }))

    expect(res.status).toBe(400)
    expect(db.select().from(clipSubtitles).where(eq(clipSubtitles.clipId, 'cl1')).all().map(row => row.text)).toEqual(['keep me'])
  })
  it('replaces all subtitle rows atomically after validation succeeds', async () => {
    const { app, db } = createTestApp()
    createReadyVideo(db, { duration: 40 })
    createClipFixture(db)
    db.insert(clipSubtitles).values({ clipId: 'cl1', start: 5, end: 6, text: 'old' }).run()

    const res = await app.handle(new Request('http://x/clips/cl1/subtitles', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subtitles: [{ start: 5, end: 6, text: 'new' }] }),
    }))

    expect(res.status).toBe(200)
    expect(db.select().from(clipSubtitles).where(eq(clipSubtitles.clipId, 'cl1')).all().map(row => row.text)).toEqual(['new'])
  })
})
