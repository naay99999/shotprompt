import { and, eq, inArray } from 'drizzle-orm';
import { analysisRuns, type DB } from '@shotprompt/db';
import { AiAnalysisError, AiProviderError, analyzeHighlights, parseStoredAnalysisOptions, type AnalysisInput, type AnalysisSource, type StoredAnalysisOptions, type AnyHighlightResult, type EvaluationContext, type EvaluationOutput, type AnalysisProgress, type EvaluatorMetadata } from '@shotprompt/core';
import { AnalysisError, loadAnalysisInput, publishAnalysisRun, sourceRevision, type PreparedCandidate } from './analysis-store';
import { prepareAnalysisThumbnails, cleanupAnalysisThumbnails } from './analysis-thumbnails';
import type { JobCtx } from './queue';
import { emitEvent } from './events';
import { evaluateAiHighlights } from './ai/evaluator';
import { createProviderClient } from './ai/provider-client';
import type { ProfileService } from './ai/provider-profiles';
export interface AnalysisRuntime {
  evaluate(input: AnalysisSource & { options: StoredAnalysisOptions }, context: EvaluationContext): Promise<EvaluationOutput>;
  thumbnails(videoId: string, runId: string, results: AnyHighlightResult[], ctx: JobCtx): Promise<PreparedCandidate[]>;
  cleanup(videoId: string, runId: string): Promise<void>;
}
export const defaultAnalysisRuntime: AnalysisRuntime = {
  evaluate: async (input, context) => {
    if ('schemaVersion' in input.options && input.options.schemaVersion === 2) {
      if (!context.snapshot) throw new AiAnalysisError('provider-not-configured');
      return evaluateAiHighlights({ ...input, options: input.options }, context, createProviderClient(context.snapshot.provider));
    }
    return { results: analyzeHighlights(input as AnalysisInput), metadata: null };
  }, thumbnails: prepareAnalysisThumbnails, cleanup: cleanupAnalysisThumbnails,
};
export function createProfileAnalysisRuntime(profiles: ProfileService): AnalysisRuntime {
  return {
    ...defaultAnalysisRuntime,
    evaluate: (input, context) => {
      if (!('schemaVersion' in input.options) || input.options.schemaVersion !== 2 || !context.snapshot?.connection) return defaultAnalysisRuntime.evaluate(input, context);
      const snapshot = context.snapshot;
      return evaluateAiHighlights({ ...input, options: input.options }, context, createProviderClient(snapshot.provider, { apiKey: () => profiles.resolveCredential(snapshot) }));
    },
  };
}
export async function runAnalysis(db: DB, runId: string, ctx: JobCtx, runtime: AnalysisRuntime = defaultAnalysisRuntime): Promise<void> {
  const run = db.select().from(analysisRuns).where(eq(analysisRuns.id, runId)).get();
  if (!run) throw new AnalysisError('not-found', 'analysis run not found');
  if (run.status !== 'queued') throw new AnalysisError('invalid-state', 'analysis is not queued');
  const metadata = run.evaluatorMetadataJson ? JSON.parse(run.evaluatorMetadataJson) as EvaluatorMetadata : null;
  const snapshot = metadata?.snapshot ?? null, started = Date.now(), deadline = new AbortController();
  const timer = snapshot ? setTimeout(() => deadline.abort(new AiAnalysisError('run-timeout')), snapshot.provider.runTimeoutSeconds * 1000) : null;
  const signal = AbortSignal.any([ctx.signal, deadline.signal]), childCtx = { ...ctx, signal };
  const emit = (status: string) => emitEvent('analysis:update', { videoId: run.videoId, runId, jobId: run.jobId, status });
  const onProgress = (progress: AnalysisProgress) => {
    signal.throwIfAborted();
    db.update(analysisRuns).set({ progressJson: JSON.stringify(progress) }).where(and(eq(analysisRuns.id, runId), eq(analysisRuns.status, 'running'))).run(); emit('running');
  };
  try {
    signal.throwIfAborted();
    db.update(analysisRuns).set({ status: 'running' }).where(eq(analysisRuns.id, runId)).run(); emit('running');
    const input = loadAnalysisInput(db, run.videoId, parseStoredAnalysisOptions(JSON.parse(run.optionsJson)));
    if (run.sourceRevision !== sourceRevision(input)) throw new AnalysisError('source-changed', 'source changed');
    await new Promise<void>(resolve => setImmediate(resolve)); signal.throwIfAborted();
    const output = await runtime.evaluate(input, { signal, snapshot, onProgress });
    signal.throwIfAborted();
    onProgress({ stage: 'thumbnails', completed: 0, total: output.results.length, requestCount: output.metadata?.requestCount ?? 0, elapsedMs: Date.now() - started });
    const rows = await runtime.thumbnails(run.videoId, runId, output.results, childCtx);
    signal.throwIfAborted();
    onProgress({ stage: 'thumbnails', completed: rows.length, total: rows.length, requestCount: output.metadata?.requestCount ?? 0, elapsedMs: Date.now() - started });
    if (output.metadata) output.metadata.elapsedMs = Date.now() - started;
    publishAnalysisRun(db, runId, input, rows, signal, output.metadata); emit('done');
  } catch (error) {
    const status = ctx.signal.aborted ? 'canceled' : 'failed';
    const cause = !ctx.signal.aborted && deadline.signal.aborted ? deadline.signal.reason : error;
    const safeError = cause instanceof AiAnalysisError || cause instanceof AnalysisError ? cause : cause instanceof AiProviderError ? new AiAnalysisError(cause.code) : new AiAnalysisError(snapshot ? 'analysis-failed' : 'evaluation-failed');
    db.update(analysisRuns).set({ status, completedAt: Date.now(), error: safeError.message }).where(and(eq(analysisRuns.id, runId), inArray(analysisRuns.status, ['queued', 'running']))).run();
    await runtime.cleanup(run.videoId, runId); emit(status); throw safeError;
  } finally { if (timer !== null) clearTimeout(timer); }
}
