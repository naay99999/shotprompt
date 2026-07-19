import type { DB } from '@shotprompt/db'
import { JobQueue, type JobRunner } from './queue'
import { makePipelineRunner } from './pipeline'

export interface Ctx { db: DB; pipelineQueue: JobQueue; exportQueue: JobQueue }

// TODO(Task 11): replace with the real export runner from routes/exports.ts once it lands.
const stubExportRunner: JobRunner = async () => { throw new Error('not implemented') }

export function createCtx(db: DB, opts: { autoRun?: boolean } = {}): Ctx {
  const autoRun = opts.autoRun !== false
  const wrap = (q: JobQueue) => autoRun ? q : Object.assign(q, { enqueue: () => {} })
  const pipelineQueue = wrap(new JobQueue(db, 'pipeline', makePipelineRunner(db)))
  const exportQueue = wrap(new JobQueue(db, 'export', stubExportRunner))
  return { db, pipelineQueue, exportQueue }
}
