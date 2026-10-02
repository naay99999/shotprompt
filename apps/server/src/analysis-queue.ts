import { eq } from 'drizzle-orm';
import { analysisRuns, type DB } from '@shotprompt/db';
import type { JobRunner } from './queue';
import { runAnalysis, type AnalysisRuntime } from './analysis-service';
export function makeAnalysisRunner(db: DB, runtime?: AnalysisRuntime): JobRunner {
  return async (jobId, ctx) => {
    const run = db.select().from(analysisRuns).where(eq(analysisRuns.jobId, jobId)).get();
    if (!run) throw new Error('analysis run not found');
    await runAnalysis(db, run.id, ctx, runtime);
  };
}
