import { eq } from 'drizzle-orm'
import { candidates, keywords, scenes, segments, videos, type DB } from '@shotprompt/db'
import { detectHooks, type KeywordTier, type Language } from '@shotprompt/core'
import type { JobCtx } from '../queue'

export function satisfied(db: DB, videoId: string): boolean { return false } // cheap & pure — always recompute on retry

export async function run(db: DB, videoId: string, _ctx: JobCtx) {
  const v = db.select().from(videos).where(eq(videos.id, videoId)).get()!
  const segs = db.select().from(segments).where(eq(segments.videoId, videoId)).all()
    .sort((a, b) => a.start - b.start)
  const scn = db.select().from(scenes).where(eq(scenes.videoId, videoId)).all().map(s => s.time)
  const kws = db.select().from(keywords).where(eq(keywords.language, v.language)).all()
  const tiers: KeywordTier[] = [1, 2, 3].map(tier => ({
    tier: tier as 1 | 2 | 3,
    weight: kws.find(k => k.tier === tier)?.weight ?? 0,
    keywords: kws.filter(k => k.tier === tier).map(k => k.word),
  }))
  const clips = detectHooks(segs, scn, tiers, v.language as Language, v.duration ?? undefined)
  db.delete(candidates).where(eq(candidates.videoId, videoId)).run()
  if (clips.length)
    db.insert(candidates).values(clips.map(c => ({ id: crypto.randomUUID(), videoId, start: c.start, end: c.end, score: c.score }))).run()
}
