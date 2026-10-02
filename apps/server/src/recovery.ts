import { readdirSync, rmSync, existsSync } from 'node:fs'
import { join, sep } from 'node:path'
import { inArray } from 'drizzle-orm'
import { analysisRuns, jobs, jobSteps, videos, exportsTable, type DB } from '@shotprompt/db'
import { DATA_DIR, MODELS_DIR, videoDir } from './env'

// A directory is "under" MODELS_DIR if it IS MODELS_DIR or nested inside it — compared
// with a trailing separator so e.g. a sibling `models-other` dir doesn't false-match.
const underModelsDir = (dir: string) => dir === MODELS_DIR || dir.startsWith(MODELS_DIR + sep)

export function recover(db: DB) {
  const stale = ['running', 'queued']
  for (const run of db.select().from(analysisRuns).where(inArray(analysisRuns.status, stale)).all()) {
    rmSync(join(videoDir(run.videoId), 'thumbs', `${run.id}.tmp`), { recursive: true, force: true })
    rmSync(join(videoDir(run.videoId), 'thumbs', run.id), { recursive: true, force: true })
  }
  db.update(analysisRuns).set({ status: 'failed', error: 'analysis interrupted: server restarted', completedAt: Date.now() }).where(inArray(analysisRuns.status, stale)).run()
  db.update(jobs).set({ status: 'failed', error: 'server restarted' }).where(inArray(jobs.status, stale)).run()
  db.update(jobSteps).set({ status: 'failed', error: 'server restarted' }).where(inArray(jobSteps.status, stale)).run()
  // A video/export still sitting in a non-terminal state at startup means its
  // pipeline/export job was interrupted mid-run (the job row above is now `failed`,
  // but nothing previously reflected that back onto the video/export). Flip both to
  // `failed` so the UI can offer retry/delete instead of a permanent, non-actionable
  // spinner. `ready`/`done` and already-`failed` rows are left untouched.
  db.update(videos).set({ status: 'failed' }).where(inArray(videos.status, ['uploaded', 'processing'])).run()
  db.update(exportsTable).set({ status: 'failed' }).where(inArray(exportsTable.status, ['queued', 'rendering'])).run()
  if (existsSync(DATA_DIR))
    // NOTE: substring match, not `.endsWith('.tmp')` — later tasks name temp files
    // like `<final>.tmp.wav` / `<final>.tmp.mp4` to preserve extensions for ffmpeg
    // format auto-detection, so any filename containing `.tmp` must be swept.
    // Model downloads (under MODELS_DIR, e.g. `ggml-<model>.bin.tmp.bin`) are excluded:
    // they resume via their own HTTP Range logic keyed off that same tmp file, so
    // sweeping it here would silently break cross-restart download resume. They're not
    // orphaned pipeline/export artifacts — they're a legitimately resumable download.
    for (const f of readdirSync(DATA_DIR, { recursive: true, withFileTypes: true }))
      if (f.isFile() && f.name.includes('.tmp') && !underModelsDir(f.parentPath))
        rmSync(join(f.parentPath, f.name), { force: true })
}
