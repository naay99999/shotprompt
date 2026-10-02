import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq, isNull } from 'drizzle-orm'
import { candidates, videos, type DB } from '@shotprompt/db'
import { buildThumbnailArgs } from '@shotprompt/core'
import { videoDir } from '../env'
import type { JobCtx } from '../queue'
import { runCmd, renameTmp } from './spawn'

export function satisfied(db: DB, videoId: string): boolean {
  if (db.select().from(videos).where(eq(videos.id, videoId)).get()?.activeAnalysisRunId) return true
  return db.select().from(candidates).where(and(eq(candidates.videoId, videoId), isNull(candidates.thumbnailPath))).all().length === 0
}
export async function run(db: DB, videoId: string, ctx: JobCtx) {
  const dir = videoDir(videoId)
  const src = join(dir, 'source.mp4')
  for (const c of db.select().from(candidates).where(and(eq(candidates.videoId, videoId), isNull(candidates.thumbnailPath))).all()) {
    const out = join(dir, 'thumbs', `${c.id}.jpg`), tmp = join(dir, 'thumbs', `${c.id}.tmp.jpg`)
    // NOTE: same `.tmp` mid-extension fix as normalize.ts — ffmpeg can't detect
    // the mjpeg muxer from a bare `.tmp` extension (`<id>.jpg.tmp` fails).
    try {
      await runCmd('ffmpeg', buildThumbnailArgs(src, (c.start + c.end) / 2, tmp), ctx)
      await renameTmp(tmp, out)
    } catch (e) {
      // Cancellation (or any other failure) can leave this candidate's partial
      // thumbnail behind — clean up only the current iteration's tmp file (prior
      // candidates in this loop have already been renamed to their final path).
      if (existsSync(tmp)) rmSync(tmp, { force: true })
      throw e
    }
    db.update(candidates).set({ thumbnailPath: out }).where(eq(candidates.id, c.id)).run()
  }
}
