import { readdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { inArray } from 'drizzle-orm'
import { jobs, jobSteps, type DB } from '@shotprompt/db'
import { DATA_DIR } from './env'

export function recover(db: DB) {
  const stale = ['running', 'queued']
  db.update(jobs).set({ status: 'failed', error: 'server restarted' }).where(inArray(jobs.status, stale)).run()
  db.update(jobSteps).set({ status: 'failed', error: 'server restarted' }).where(inArray(jobSteps.status, stale)).run()
  if (existsSync(DATA_DIR))
    // NOTE: substring match, not `.endsWith('.tmp')` — later tasks name temp files
    // like `<final>.tmp.wav` / `<final>.tmp.mp4` to preserve extensions for ffmpeg
    // format auto-detection, so any filename containing `.tmp` must be swept.
    for (const f of readdirSync(DATA_DIR, { recursive: true, withFileTypes: true }))
      if (f.isFile() && f.name.includes('.tmp')) rmSync(join(f.parentPath, f.name), { force: true })
}
