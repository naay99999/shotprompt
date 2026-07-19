import { describe, expect, it } from 'bun:test'
import { createDb, candidates, clipSubtitles, segments, videos } from '@shotprompt/db'
import { eq } from 'drizzle-orm'
import { createClip, updateClip } from '../src/clip-service'

function seeded() {
  const db = createDb(':memory:')
  db.insert(videos).values({ id: 'v1', filename: 'a.mp4', path: '/x', status: 'ready', language: 'th', createdAt: 1 }).run()
  db.insert(segments).values([
    { videoId: 'v1', start: 0, end: 5, text: 'a' },
    { videoId: 'v1', start: 10, end: 15, text: 'b' },
    { videoId: 'v1', start: 20, end: 25, text: 'c' },
    { videoId: 'v1', start: 30, end: 35, text: 'd' },
  ]).run()
  db.insert(candidates).values({ id: 'c1', videoId: 'v1', start: 8, end: 26, score: 55 }).run()
  return db
}

describe('createClip', () => {
  it('from candidate copies range/score and overlapping subtitles', () => {
    const db = seeded()
    const clip = createClip(db, 'v1', { candidateId: 'c1' })
    expect(clip.start).toBe(8); expect(clip.score).toBe(55); expect(clip.candidateId).toBe('c1')
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
})
