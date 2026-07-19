import { join } from 'node:path'
import { count, eq } from 'drizzle-orm'
import { scenes, type DB } from '@shotprompt/db'
import { buildSceneArgs, parseSceneTimestamps } from '@shotprompt/core'
import { videoDir } from '../env'
import type { JobCtx } from '../queue'
import { runCmd } from './spawn'

export function satisfied(db: DB, videoId: string): boolean {
  return (db.select({ n: count() }).from(scenes).where(eq(scenes.videoId, videoId)).get()?.n ?? 0) > 0
}
export async function run(db: DB, videoId: string, ctx: JobCtx) {
  const { stderr } = await runCmd('ffmpeg', buildSceneArgs(join(videoDir(videoId), 'source.mp4')), ctx, { ignoreExitCode: true })
  const ts = parseSceneTimestamps(stderr)
  db.delete(scenes).where(eq(scenes.videoId, videoId)).run()
  if (ts.length) db.insert(scenes).values(ts.map(time => ({ videoId, time }))).run()
}
