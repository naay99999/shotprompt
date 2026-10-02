import { expect, it } from 'bun:test';
import { createDb, videos, jobs, analysisRuns, segments } from '@shotprompt/db';
import { eq } from 'drizzle-orm';
import { createCtx } from '../src/context';
import { JobQueue } from '../src/queue';
import { PIPELINE_STEPS } from '../src/pipeline';
import { schedulePipelineAnalysis } from '../src/analysis-enqueue';
import { saveProviderConfig, parseProviderConfig } from '../src/ai/provider-settings';
import { parseAiAnalysisOptions } from '@shotprompt/core';
it('prepared video stays ready without AI and a failed scheduling callback cannot fail a completed pipeline', async () => {
  const db = createDb(':memory:');
  db.insert(videos).values({ id: 'v', filename: 'x', path: '/x', status: 'uploaded', duration: 40, language: 'th', createdAt: 1 }).run();
  db.insert(jobs).values({ id: 'j', videoId: 'v', type: 'pipeline', status: 'queued', createdAt: 1 }).run();
  const steps = Object.fromEntries(PIPELINE_STEPS.map(name => [name, { satisfied: () => false, run: async () => {} }]));
  const ctx = createCtx(db, { pipelineSteps: steps }); ctx.pipelineQueue.enqueue('j'); await ctx.pipelineQueue.idle();
  expect(db.select().from(videos).get()?.status).toBe('ready'); expect(db.select().from(analysisRuns).all()).toHaveLength(0);
  db.insert(jobs).values({ id: 'j2', videoId: 'v', type: 'pipeline', status: 'queued', createdAt: 2 }).run();
  const queue = new JobQueue(db, 'pipeline', async () => {}, { onDone: () => { throw new Error('schedule failed'); } });
  queue.enqueue('j2'); await queue.idle(); expect(db.select().from(jobs).where(eq(jobs.id, 'j2')).get()?.status).toBe('done'); db.raw.close();
});
it('schedules once only after pipeline done, and an AI failure leaves the media ready', async () => {
  const db = createDb(':memory:'); saveProviderConfig(db, parseProviderConfig({ model: 'test' }));
  db.insert(videos).values({ id: 'v', filename: 'x', path: '/x', status: 'uploaded', duration: 40, language: 'th', analysisOptionsJson: JSON.stringify(parseAiAnalysisOptions(undefined)), createdAt: 1 }).run();
  db.insert(segments).values({ videoId: 'v', start: 0, end: 40, text: 'คำตอบที่ครบถ้วน' }).run();
  db.insert(jobs).values({ id: 'j', videoId: 'v', type: 'pipeline', status: 'queued', createdAt: 1 }).run();
  let pipelineDone = false;
  const steps = Object.fromEntries(PIPELINE_STEPS.map(name => [name, { satisfied: () => false, run: async () => {} }]));
  const ctx = createCtx(db, { pipelineSteps: steps, analysisRuntime: { evaluate: async () => { pipelineDone = db.select().from(jobs).where(eq(jobs.id, 'j')).get()?.status === 'done'; throw new Error('model offline'); }, thumbnails: async () => [], cleanup: async () => {} } });
  const migrated = ctx.profiles.list().profiles[0];
  if (migrated) { const profile = ctx.profiles.get(migrated.id); ctx.profiles.recordCheck(profile.id, profile.revision, { fingerprint: ctx.profiles.fingerprint(profile), revision: profile.revision, status: 'ready', checkedAt: 1, errorCode: null }); ctx.profiles.activate(profile.id, profile.revision); }
  ctx.pipelineQueue.enqueue('j'); await ctx.pipelineQueue.idle(); await ctx.analysisQueue.idle();
  schedulePipelineAnalysis(ctx, 'j');
  expect(pipelineDone).toBe(true); expect(db.select().from(analysisRuns).all()).toHaveLength(1);
  expect(db.select().from(analysisRuns).get()?.status).toBe('failed'); expect(db.select().from(videos).get()?.status).toBe('ready'); db.raw.close();
});
