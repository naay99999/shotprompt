import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { videos, type DB } from '@shotprompt/db'
import { buildNormalizeArgs, buildProbeArgs, needsTranscode, parseProbe } from '@shotprompt/core'
import { videoDir } from '../env'
import type { JobCtx } from '../queue'
import { runCmd, renameTmp } from './spawn'

export function satisfied(db: DB, videoId: string): boolean {
  const v = db.select().from(videos).where(eq(videos.id, videoId)).get()
  return !!v?.duration && existsSync(join(videoDir(videoId), 'source.mp4'))
}

export async function run(db: DB, videoId: string, ctx: JobCtx) {
  const v = db.select().from(videos).where(eq(videos.id, videoId)).get()!
  const dir = videoDir(videoId)
  mkdirSync(join(dir, 'thumbs'), { recursive: true }); mkdirSync(join(dir, 'exports'), { recursive: true })
  const probeProc = Bun.spawn(['ffprobe', ...buildProbeArgs(v.path)], { stdout: 'pipe' })
  const probe = parseProbe(await new Response(probeProc.stdout).text())
  const out = join(dir, 'source.mp4'), tmp = join(dir, 'source.tmp.mp4')
  // NOTE: `.tmp` is inserted *before* the extension (not appended after it, as
  // `out + '.tmp'` would do) because ffmpeg picks its output muxer from the
  // filename extension; `source.mp4.tmp` fails with "Unable to choose an
  // output format" (verified locally). This matches the naming convention
  // documented in recovery.ts's sweep comment (`<final>.tmp.mp4`), and the
  // sweep's `f.name.includes('.tmp')` check still matches this filename.
  await runCmd('ffmpeg', buildNormalizeArgs(v.path, tmp, needsTranscode(probe)), ctx)
  await renameTmp(tmp, out)
  if (v.path !== out) rmSync(v.path, { force: true }) // delete raw upload
  db.update(videos).set({ path: out, duration: probe.duration, width: probe.width, height: probe.height })
    .where(eq(videos.id, videoId)).run()
}
