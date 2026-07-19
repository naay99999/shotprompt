import type { DB } from '@shotprompt/db'
import { JobQueue } from './queue'
import { makePipelineRunner } from './pipeline'
import { makeExportRunner } from './routes/exports'

export interface Ctx { db: DB; pipelineQueue: JobQueue; exportQueue: JobQueue }

export function createCtx(db: DB, opts: { autoRun?: boolean } = {}): Ctx {
  const autoRun = opts.autoRun !== false
  const wrap = (q: JobQueue) => autoRun ? q : Object.assign(q, { enqueue: () => {} })
  const pipelineQueue = wrap(new JobQueue(db, 'pipeline', makePipelineRunner(db)))
  const exportQueue = wrap(new JobQueue(db, 'export', makeExportRunner(db)))
  return { db, pipelineQueue, exportQueue }
}
