import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { count, eq } from 'drizzle-orm'
import { segments, type DB } from '@shotprompt/db'
import { buildExtractAudioArgs } from '@shotprompt/core'
import { videoDir } from '../env'
import type { JobCtx } from '../queue'
import { runCmd, renameTmp } from './spawn'

const hasSegments = (db: DB, videoId: string) =>
  (db.select({ n: count() }).from(segments).where(eq(segments.videoId, videoId)).get()?.n ?? 0) > 0

export function satisfied(db: DB, videoId: string): boolean {
  return existsSync(join(videoDir(videoId), 'audio.wav')) || hasSegments(db, videoId)
}
export async function run(db: DB, videoId: string, ctx: JobCtx) {
  const dir = videoDir(videoId)
  const out = join(dir, 'audio.wav'), tmp = out + '.tmp.wav' // keep .wav suffix for ffmpeg format detection; sweep matches *.tmp* — use '.tmp.wav' and sweep pattern includes it
  try {
    await runCmd('ffmpeg', buildExtractAudioArgs(join(dir, 'source.mp4'), tmp), ctx)
    await renameTmp(tmp, out)
  } catch (e) {
    // Cancellation (or any other failure) can leave a partial ffmpeg output behind —
    // clean it up immediately rather than waiting for the next server-restart sweep.
    if (existsSync(tmp)) rmSync(tmp, { force: true })
    throw e
  }
}
