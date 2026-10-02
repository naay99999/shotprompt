import { and, desc, eq } from 'drizzle-orm'
import { jobs, jobSteps, videos, type DB } from '@shotprompt/db'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { JobCtx, JobRunner } from './queue'
import { emitEvent } from './events'
import { videoDir } from './env'
import * as normalize from './steps/normalize'
import * as extractAudio from './steps/extract-audio'
import * as transcribe from './steps/transcribe'
import * as detectScenes from './steps/detect-scenes'

export const PIPELINE_STEPS = ['normalize', 'extract-audio', 'transcribe', 'detect-scenes', 'detect-hooks', 'thumbnails'] as const
export type StepImpl = { run(db: DB, videoId: string, ctx: JobCtx): Promise<void>; satisfied(db: DB, videoId: string): boolean }
const DEFAULT_STEPS: Record<string, StepImpl> = {
  normalize, 'extract-audio': extractAudio, transcribe, 'detect-scenes': detectScenes,
  'detect-hooks': { satisfied: () => true, run: async () => {} },
  thumbnails: { satisfied: () => true, run: async () => {} },
}

export function makePipelineRunner(db: DB, steps: Record<string, StepImpl> = DEFAULT_STEPS): JobRunner {
  return async (jobId, ctx) => {
    const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get()!
    const videoId = job.videoId
    db.update(videos).set({ status: 'processing' }).where(eq(videos.id, videoId)).run()
    try {
      for (const name of PIPELINE_STEPS) {
        const stepRow = db.insert(jobSteps).values({ jobId, name, status: 'running', startedAt: Date.now() }).returning().get()
        const finish = (status: string, error?: string) => {
          db.update(jobSteps).set({ status, error: error ?? null, completedAt: Date.now() }).where(eq(jobSteps.id, stepRow.id)).run()
          emitEvent('step:update', { videoId, jobId, name, status })
        }
        emitEvent('step:update', { videoId, jobId, name, status: 'running' })
        if (steps[name].satisfied(db, videoId)) { finish('done'); continue }
        try { await steps[name].run(db, videoId, ctx); finish('done') }
        catch (e) { finish('failed', e instanceof Error ? e.message : String(e)); throw e }
      }
      const audio = join(videoDir(videoId), 'audio.wav')
      if (existsSync(audio)) rmSync(audio)
      db.update(videos).set({ status: 'ready' }).where(eq(videos.id, videoId)).run()
      emitEvent('video:update', { videoId, status: 'ready' })
    } catch (e) {
      db.update(videos).set({ status: 'failed' }).where(eq(videos.id, videoId)).run()
      emitEvent('video:update', { videoId, status: 'failed' })
      throw e
    }
  }
}
