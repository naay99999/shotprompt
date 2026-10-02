import { expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createDb, videos, segments, analysisRuns, candidates } from '@shotprompt/db';
import { parseAiAnalysisOptions } from '@shotprompt/core';
import { createAnalysisRun } from '../src/analysis-store';
import { runAnalysis, type AnalysisRuntime } from '../src/analysis-service';
import { createEvaluatorSnapshot, parseProviderConfig, saveProviderConfig } from '../src/ai/provider-settings';
import { evaluateAiHighlights } from '../src/ai/evaluator';
import { fixtureAiSource, fixtureModelResponse } from './helpers/ai-fixtures';
export function aiServiceSetup() {
  const db = createDb(':memory:');
  db.insert(videos).values({ id: 'v', filename: 'test', path: '/test', duration: 80, language: 'th', status: 'ready', activeAnalysisRunId: 'previous', createdAt: 1 }).run();
  db.insert(segments).values(fixtureAiSource.segments.map(s => ({ ...s, videoId: 'v' }))).run();
  const snapshot = createEvaluatorSnapshot(parseProviderConfig({ model: 'original' }));
  saveProviderConfig(db, snapshot.provider);
  return { db, snapshot, options: parseAiAnalysisOptions(undefined), controller: new AbortController() };
}
it('uses queued configuration and publishes evaluator provenance atomically', async () => {
  const { db, snapshot, options, controller } = aiServiceSetup();
  const run = createAnalysisRun(db, 'v', 'j', options, snapshot);
  saveProviderConfig(db, { ...snapshot.provider, model: 'different' });
  let model = '';
  const runtime: AnalysisRuntime = { evaluate: async (input, context) => { model = context.snapshot!.provider.model; return evaluateAiHighlights(input as any, context, { complete: async req => fixtureModelResponse(req) }); }, thumbnails: async (_v, _r, rows) => rows.map(r => ({ ...r, id: crypto.randomUUID(), thumbnailPath: '/tmp/fixture' })), cleanup: async () => {} };
  await runAnalysis(db, run.id, { signal: controller.signal, setChild: () => {} }, runtime);
  expect(model).toBe('original'); expect(db.select().from(videos).get()?.activeAnalysisRunId).toBe(run.id);
  expect(JSON.parse(db.select().from(analysisRuns).get()!.evaluatorMetadataJson!).snapshot.provider.model).toBe('original');
  expect(db.select().from(candidates).get()?.score).toBe(80); db.raw.close();
});
it('run deadline reaches thumbnails and preserves previous results as a failed run', async () => {
  const { db, snapshot, options, controller } = aiServiceSetup(); snapshot.provider.runTimeoutSeconds = .01;
  const run = createAnalysisRun(db, 'v', 'j', options, snapshot); let cleaned = false;
  await expect(runAnalysis(db, run.id, { signal: controller.signal, setChild: () => {} }, {
    evaluate: async () => ({ results: [], metadata: null }),
    thumbnails: async (_v, _r, _rows, context) => { await new Promise<void>((_, reject) => { const watchdog = setTimeout(() => reject(new Error('deadline did not propagate')), 100); context.signal.addEventListener('abort', () => { clearTimeout(watchdog); reject(context.signal.reason); }, { once: true }); }); return []; },
    cleanup: async () => { cleaned = true; },
  })).rejects.toThrow('run-timeout');
  expect(cleaned).toBe(true); expect(db.select().from(videos).get()?.activeAnalysisRunId).toBe('previous');
  expect(db.select().from(analysisRuns).where(eq(analysisRuns.id, run.id)).get()?.status).toBe('failed'); db.raw.close();
});
it('preserves deadline reason when a media process rejects with a generic cancellation error', async () => {
  const { db, snapshot, options, controller } = aiServiceSetup(); snapshot.provider.runTimeoutSeconds = .01;
  const run = createAnalysisRun(db, 'v', 'j', options, snapshot);
  await expect(runAnalysis(db, run.id, { signal: controller.signal, setChild: () => {} }, {
    evaluate: async () => ({ results: [], metadata: null }),
    thumbnails: async (_v, _r, _rows, context) => { await new Promise<void>((_, reject) => context.signal.addEventListener('abort', () => reject(new Error('canceled')), { once: true })); return []; }, cleanup: async () => {},
  })).rejects.toThrow('run-timeout');
  expect(db.select().from(analysisRuns).get()?.error).toBe('run-timeout');
  expect(db.select().from(videos).get()?.activeAnalysisRunId).toBe('previous'); db.raw.close();
});
