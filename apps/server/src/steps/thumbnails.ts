import { join } from 'node:path'
import { and, eq, isNull } from 'drizzle-orm'
import { candidates, type DB } from '@shotprompt/db'
import { buildThumbnailArgs } from '@shotprompt/core'
import { videoDir } from '../env'
import type { JobCtx } from '../queue'
import { runCmd, renameTmp } from './spawn'

export function satisfied(db: DB, videoId: string): boolean {
  return db.select().from(candidates).where(and(eq(candidates.videoId, videoId), isNull(candidates.thumbnailPath))).all().length === 0
}
export async function run(db: DB, videoId: string, ctx: JobCtx) {
  const dir = videoDir(videoId)
  const src = join(dir, 'source.mp4')
  for (const c of db.select().from(candidates).where(and(eq(candidates.videoId, videoId), isNull(candidates.thumbnailPath))).all()) {
    const out = join(dir, 'thumbs', `${c.id}.jpg`), tmp = join(dir, 'thumbs', `${c.id}.tmp.jpg`)
    // NOTE: same `.tmp` mid-extension fix as normalize.ts — ffmpeg can't detect
    // the mjpeg muxer from a bare `.tmp` extension (`<id>.jpg.tmp` fails).
    await runCmd('ffmpeg', buildThumbnailArgs(src, (c.start + c.end) / 2, tmp), ctx)
    await renameTmp(tmp, out)
    db.update(candidates).set({ thumbnailPath: out }).where(eq(candidates.id, c.id)).run()
  }
}
