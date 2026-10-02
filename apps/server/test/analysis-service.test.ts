import { expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createDb, videos, scenes, analysisRuns, candidates } from '@shotprompt/db';
import { analyzeHighlights, parseAnalysisOptions, type AnalysisInput } from '@shotprompt/core';
import { createAnalysisRun } from '../src/analysis-store';
import { runAnalysis, type AnalysisRuntime } from '../src/analysis-service';
import { recover } from '../src/recovery';
function setup() {
  const db = createDb(':memory:');
  db.insert(videos).values({ id: 'v', filename: 'x', path: '/x', language: 'en', duration: 30, status: 'ready', createdAt: 1, activeAnalysisRunId: 'old-run' }).run();
  db.insert(scenes).values({ videoId: 'v', time: 0 }).run();
  const run = createAnalysisRun(db, 'v', 'job', parseAnalysisOptions(undefined));
  const controller = new AbortController(); const ctx = { signal: controller.signal, setChild: () => {} };
  return { db, run, controller, ctx };
}
for (const failure of ['evaluate', 'thumbnail', 'cancel', 'revision']) it(`keeps previous results on ${failure}`, async () => {
  const { db, run, controller, ctx } = setup(); let cleaned = false;
  const runtime: AnalysisRuntime = {
    evaluate: async input => { if (failure === 'evaluate') throw new Error('evaluation failed'); return { results: analyzeHighlights(input as AnalysisInput), metadata: null }; },
    thumbnails: async (_v, _r, rows) => {
      if (failure === 'thumbnail') throw new Error('thumbnail failed');
      if (failure === 'cancel') controller.abort();
      if (failure === 'revision') db.update(videos).set({ duration: 40 }).run();
      return rows.map(row => ({ ...row, id: crypto.randomUUID(), thumbnailPath: '/tmp/image.jpg' }));
    }, cleanup: async () => { cleaned = true; },
  };
  await expect(runAnalysis(db, run.id, ctx, runtime)).rejects.toThrow();
  expect(db.select().from(videos).get()).toMatchObject({ status: 'ready', activeAnalysisRunId: 'old-run' });
  expect(db.select().from(candidates).all()).toHaveLength(0); expect(cleaned).toBe(true);
  expect(db.select().from(analysisRuns).get()?.status).toBe(failure === 'cancel' ? 'canceled' : 'failed'); db.raw.close();
});
it('publishes complete results and restart marks unfinished analysis failed without changing ready video', async () => {
  const { db, run, ctx } = setup();
  await runAnalysis(db, run.id, ctx, { evaluate: async input => ({ results: analyzeHighlights(input as AnalysisInput), metadata: null }), thumbnails: async (_v, _r, rows) => rows.map(r => ({ ...r, id: crypto.randomUUID(), thumbnailPath: '/tmp/x' })), cleanup: async () => {} });
  expect(db.select().from(videos).get()?.activeAnalysisRunId).toBe(run.id);
  const next = createAnalysisRun(db, 'v', 'next', parseAnalysisOptions(undefined)); recover(db);
  expect(db.select().from(analysisRuns).where(eq(analysisRuns.id, next.id)).get()?.status).toBe('failed');
  expect(db.select().from(videos).get()).toMatchObject({ status: 'ready', activeAnalysisRunId: run.id }); db.raw.close();
});
it('cancellation before evaluation never publishes', async () => {
  const { db, run, controller, ctx } = setup(); controller.abort(); let evaluated = false;
  await expect(runAnalysis(db, run.id, ctx, { evaluate: async () => { evaluated = true; return { results: [], metadata: null }; }, thumbnails: async () => [], cleanup: async () => {} })).rejects.toThrow();
  expect(evaluated).toBe(false); expect(db.select().from(videos).get()?.activeAnalysisRunId).toBe('old-run'); db.raw.close();
});
