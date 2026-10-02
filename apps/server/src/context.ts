import { aiCredentials, type DB } from '@shotprompt/db'
import { existsSync } from 'node:fs'
import { JobQueue } from './queue'
import { schedulePipelineAnalysis } from './analysis-enqueue'
import { makePipelineRunner, type StepImpl } from './pipeline'
import { makeExportRunner } from './routes/exports'
import { makeAnalysisRunner } from './analysis-queue'
import { createProfileAnalysisRuntime, type AnalysisRuntime } from './analysis-service'
import { DATA_DIR, modelPath } from './env'
import { createCredentialVault, type CredentialVault } from './ai/credential-vault'
import { createProfileService, type ProfileService } from './ai/provider-profiles'

export interface Ctx {
  db: DB
  pipelineQueue: JobQueue
  exportQueue: JobQueue
  analysisQueue: JobQueue
  modelAvailable: (name: string) => boolean
  profiles: ProfileService
}

export function createCtx(db: DB, opts: { autoRun?: boolean; pipelineSteps?: Record<string, StepImpl>; analysisRuntime?: AnalysisRuntime; modelAvailable?: (name: string) => boolean; credentialVault?: CredentialVault } = {}): Ctx {
  const autoRun = opts.autoRun !== false
  const wrap = (q: JobQueue) => autoRun ? q : Object.assign(q, { enqueue: () => {} })
  let ctx: Ctx
  const pipelineQueue = wrap(new JobQueue(db, 'pipeline', makePipelineRunner(db, opts.pipelineSteps), { onDone: jobId => schedulePipelineAnalysis(ctx, jobId) }))
  const exportQueue = wrap(new JobQueue(db, 'export', makeExportRunner(db)))
  const vault = opts.credentialVault ?? createCredentialVault({ secretsDir: `${DATA_DIR}/secrets`, hasCredentials: () => db.select().from(aiCredentials).all().length > 0 })
  const profiles = createProfileService(db, vault, { legacyKey: () => process.env.SHOTPROMPT_LLM_API_KEY })
  profiles.migrateLegacy()
  const analysisQueue = wrap(new JobQueue(db, 'analysis', makeAnalysisRunner(db, opts.analysisRuntime ?? createProfileAnalysisRuntime(profiles))))
  ctx = { db, pipelineQueue, exportQueue, analysisQueue, profiles, modelAvailable: opts.modelAvailable ?? (name => existsSync(modelPath(name))) }
  return ctx
}
