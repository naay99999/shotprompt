import { and, eq, gt, lt } from 'drizzle-orm'
import { clipSubtitles, clips, candidates, segments, type DB } from '@shotprompt/db'

function copySubtitles(db: DB, clipId: string, videoId: string, from: number, to: number) {
  const rows = db.select().from(segments)
    .where(and(eq(segments.videoId, videoId), gt(segments.end, from), lt(segments.start, to))).all()
  if (rows.length)
    db.insert(clipSubtitles).values(rows.map(r => ({ clipId, start: r.start, end: r.end, text: r.text }))).run()
}

export function createClip(db: DB, videoId: string, opts: { candidateId?: string; start?: number; end?: number }) {
  let start: number, end: number, score: number | null = null, candidateId: string | null = null
  if (opts.candidateId) {
    const c = db.select().from(candidates).where(eq(candidates.id, opts.candidateId)).get()
    if (!c) throw new Error('candidate not found')
    start = c.start; end = c.end; score = c.score; candidateId = c.id
  } else {
    if (opts.start == null || opts.end == null || opts.start >= opts.end) throw new Error('invalid range')
    start = opts.start; end = opts.end
  }
  const id = crypto.randomUUID()
  db.insert(clips).values({ id, videoId, candidateId, start, end, score, cropOffset: 0, createdAt: Date.now() }).run()
  copySubtitles(db, id, videoId, start, end)
  return db.select().from(clips).where(eq(clips.id, id)).get()!
}

export function updateClip(db: DB, clipId: string, patch: { start?: number; end?: number; cropOffset?: number }) {
  const clip = db.select().from(clips).where(eq(clips.id, clipId)).get()
  if (!clip) throw new Error('clip not found')
  const newStart = patch.start ?? clip.start, newEnd = patch.end ?? clip.end
  if (newStart >= newEnd) throw new Error('invalid range')
  if (newStart < clip.start) copySubtitles(db, clipId, clip.videoId, newStart, clip.start)
  if (newEnd > clip.end) copySubtitles(db, clipId, clip.videoId, clip.end, newEnd)
  db.update(clips).set({ start: newStart, end: newEnd, cropOffset: patch.cropOffset ?? clip.cropOffset })
    .where(eq(clips.id, clipId)).run()
  return db.select().from(clips).where(eq(clips.id, clipId)).get()!
}
