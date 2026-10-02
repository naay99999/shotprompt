import { and, eq, gt, lt } from 'drizzle-orm'
import { analysisRuns, candidateFeedback, clipSubtitles, clips, candidates, segments, videos, type DB } from '@shotprompt/db'

function getVideoDuration(db: DB, videoId: string): number {
  const video = db.select().from(videos).where(eq(videos.id, videoId)).get()
  if (!video) throw new Error('video not found')
  if (video.duration == null || !Number.isFinite(video.duration)) throw new Error('video duration unavailable')
  return video.duration
}

function assertRange(start: number, end: number, duration: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > duration || start >= end)
    throw new Error('range outside video')
}

function copySubtitles(db: DB, clipId: string, videoId: string, from: number, to: number) {
  const rows = db.select().from(segments)
    .where(and(eq(segments.videoId, videoId), gt(segments.end, from), lt(segments.start, to))).all()
  const existing = db.select({ start: clipSubtitles.start, end: clipSubtitles.end })
    .from(clipSubtitles).where(eq(clipSubtitles.clipId, clipId)).all()
  const seen = new Set(existing.map(e => `${e.start}:${e.end}`))
  const fresh = rows.filter(r => !seen.has(`${r.start}:${r.end}`))
  if (fresh.length)
    db.insert(clipSubtitles).values(fresh.map(r => ({ clipId, start: r.start, end: r.end, text: r.text }))).run()
}

export function createClip(db: DB, videoId: string, opts: { candidateId?: string; start?: number; end?: number }) {
  let start: number, end: number, score: number | null = null, candidateId: string | null = null
  let thumbnailPath: string | null = null
  let assessmentJson: string | null = null
  if (opts.candidateId) {
    const c = db.select().from(candidates).where(eq(candidates.id, opts.candidateId)).get()
    if (!c) throw new Error('candidate not found')
    if (c.videoId !== videoId) throw new Error('candidate does not belong to video')
    if (c.runId && c.assessmentJson) {
      const run = db.select().from(analysisRuns).where(eq(analysisRuns.id, c.runId)).get()
      if (!run || run.status !== 'done') throw new Error('analysis run unavailable')
      const feedback = db.select().from(candidateFeedback).where(eq(candidateFeedback.candidateId, c.id)).get()
      assessmentJson = JSON.stringify({ assessment: JSON.parse(c.assessmentJson), options: JSON.parse(run.optionsJson), runId: run.id, sourceRevision: run.sourceRevision, evaluatedStart: c.start, evaluatedEnd: c.end, feedback: feedback?.verdict ?? null, ...(run.evaluatorMetadataJson ? { evaluatorMetadata: JSON.parse(run.evaluatorMetadataJson) } : {}) })
    }
    start = c.start; end = c.end; score = c.score; candidateId = c.id; thumbnailPath = c.thumbnailPath
  } else {
    if (opts.start == null || opts.end == null) throw new Error('invalid range')
    start = opts.start; end = opts.end
  }
  assertRange(start, end, getVideoDuration(db, videoId))
  const id = crypto.randomUUID()
  db.insert(clips).values({ id, videoId, candidateId, start, end, score, assessmentJson, cropOffset: 0, thumbnailPath, createdAt: Date.now() }).run()
  copySubtitles(db, id, videoId, start, end)
  return db.select().from(clips).where(eq(clips.id, id)).get()!
}

export function updateClip(db: DB, clipId: string, patch: { start?: number; end?: number; cropOffset?: number }) {
  const clip = db.select().from(clips).where(eq(clips.id, clipId)).get()
  if (!clip) throw new Error('clip not found')
  const newStart = patch.start ?? clip.start, newEnd = patch.end ?? clip.end
  assertRange(newStart, newEnd, getVideoDuration(db, clip.videoId))
  if (patch.cropOffset != null && (!Number.isFinite(patch.cropOffset) || patch.cropOffset < -1 || patch.cropOffset > 1))
    throw new Error('invalid crop offset')
  if (newStart < clip.start) copySubtitles(db, clipId, clip.videoId, newStart, clip.start)
  if (newEnd > clip.end) copySubtitles(db, clipId, clip.videoId, clip.end, newEnd)
  db.update(clips).set({ start: newStart, end: newEnd, cropOffset: patch.cropOffset ?? clip.cropOffset })
    .where(eq(clips.id, clipId)).run()
  return db.select().from(clips).where(eq(clips.id, clipId)).get()!
}

export function replaceClipSubtitles(
  db: DB,
  clipId: string,
  rows: { start: number; end: number; text: string }[],
) {
  const clip = db.select().from(clips).where(eq(clips.id, clipId)).get()
  if (!clip) throw new Error('clip not found')
  const duration = getVideoDuration(db, clip.videoId)
  for (const row of rows) assertRange(row.start, row.end, duration)
  db.transaction(tx => {
    tx.delete(clipSubtitles).where(eq(clipSubtitles.clipId, clipId)).run()
    if (rows.length) tx.insert(clipSubtitles).values(rows.map(row => ({ clipId, ...row }))).run()
  })
}
