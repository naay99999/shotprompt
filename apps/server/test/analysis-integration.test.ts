import { expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createDb, videos, segments, scenes, candidates, candidateFeedback, analysisRuns, clips } from '@shotprompt/db';
import { parseAiAnalysisOptions, type AiAnalysisInput } from '@shotprompt/core';
import { saveProviderConfig, parseProviderConfig } from '../src/ai/provider-settings';
import { evaluateAiHighlights } from '../src/ai/evaluator';
import { fixtureModelResponse } from './helpers/ai-fixtures';
import { createApp } from '../src/app';
import { createCtx } from '../src/context';
it('keeps accepted clip provenance across reruns, feedback, cancellation and deletion', async () => {
  const db = createDb(':memory:'); saveProviderConfig(db, parseProviderConfig({ model: 'test' })); let block = false;
  const ctx = createCtx(db, { analysisRuntime: {
    evaluate: async (input, context) => evaluateAiHighlights(input as AiAnalysisInput, context, { complete: async request => fixtureModelResponse(request) }),
    thumbnails: async (_videoId, _runId, results, job) => {
      if (block) await new Promise<void>((_resolve, reject) => { if (job.signal.aborted) reject(new Error('aborted')); else job.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); });
      return results.map(result => ({ ...result, id: crypto.randomUUID(), thumbnailPath: '/tmp/synthetic.jpg' }));
    }, cleanup: async () => {},
  } });
  const migrated = ctx.profiles.list().profiles[0];
  if (migrated) { const profile = ctx.profiles.get(migrated.id); ctx.profiles.recordCheck(profile.id, profile.revision, { fingerprint: ctx.profiles.fingerprint(profile), revision: profile.revision, status: 'ready', checkedAt: 1, errorCode: null }); ctx.profiles.activate(profile.id, profile.revision); }
  const app = createApp(ctx), id = crypto.randomUUID();
  db.insert(videos).values({ id, filename: 'test.mp4', path: '/tmp/test.mp4', status: 'ready', language: 'th', duration: 30, createdAt: 1 }).run();
  db.insert(segments).values({ videoId: id, start: 0, end: 30, text: 'ข้อผิดพลาด วิธีทำ ยกตัวอย่าง สรุปคือ' }).run();
  const request = (path: string, method = 'GET', body?: unknown) => app.handle(new Request(`http://x${path}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) }));
  expect((await request(`/videos/${id}/analysis`, 'POST', parseAiAnalysisOptions(undefined))).status).toBe(202); await ctx.analysisQueue.idle();
  const first = await (await request(`/videos/${id}/candidates`)).json(); expect(first.length).toBeGreaterThan(0);
  expect((await request(`/videos/${id}/candidates/${first[0].id}/feedback`, 'PUT', { verdict: 'good' })).status).toBe(200);
  const clip = await (await request(`/videos/${id}/clips`, 'POST', { candidateId: first[0].id })).json();
  expect(clip.assessment.feedback).toBe('good'); const saved = clip.assessment;
  expect((await request(`/videos/${id}/analysis`, 'POST', parseAiAnalysisOptions({ instruction: 'เรื่องเล่า' }))).status).toBe(202); await ctx.analysisQueue.idle();
  const next = await (await request(`/videos/${id}/analysis`)).json(); expect(next.active.id).not.toBe(saved.runId);
  const reloaded = await (await request(`/videos/${id}/clips`)).json(); expect(reloaded[0].assessment).toEqual(saved); expect(reloaded[0].candidateId).toBe(first[0].id);
  expect((await (await request(`/videos/${id}/candidates?runId=${saved.runId}`)).json())[0].id).toBe(first[0].id);
  block = true; const third = await (await request(`/videos/${id}/analysis`, 'POST', parseAiAnalysisOptions(undefined))).json();
  expect((await request(`/jobs/${third.jobId}/cancel`, 'POST')).status).toBe(200); await ctx.analysisQueue.idle();
  expect(db.select().from(videos).where(eq(videos.id, id)).get()?.activeAnalysisRunId).toBe(next.active.id);
  expect((await request(`/videos/${id}/candidates/${first[0].id}/feedback`, 'DELETE')).status).toBe(200);
  expect((await request(`/videos/${id}`, 'DELETE')).status).toBe(200);
  for (const table of [analysisRuns, candidates, candidateFeedback, clips]) expect(db.select().from(table).all()).toHaveLength(0);
  db.raw.close();
});
it('null scores survive scene-only evaluation through storage and route', async () => {
  const db = createDb(':memory:'); saveProviderConfig(db, parseProviderConfig({ model: 'test' })); const id = crypto.randomUUID();
  const ctx = createCtx(db, { analysisRuntime: { evaluate: async (input, context) => evaluateAiHighlights(input as AiAnalysisInput, context, { complete: async request => fixtureModelResponse(request) }), thumbnails: async (_v, _r, rows) => rows.map(r => ({ ...r, id: crypto.randomUUID(), thumbnailPath: '/tmp/test.jpg' })), cleanup: async () => {} } });
  const migrated = ctx.profiles.list().profiles[0];
  if (migrated) { const profile = ctx.profiles.get(migrated.id); ctx.profiles.recordCheck(profile.id, profile.revision, { fingerprint: ctx.profiles.fingerprint(profile), revision: profile.revision, status: 'ready', checkedAt: 1, errorCode: null }); ctx.profiles.activate(profile.id, profile.revision); }
  db.insert(videos).values({ id, filename: 'x', path: '/x', status: 'ready', language: 'ja', duration: 30, createdAt: 1 }).run();
  db.insert(scenes).values({ videoId: id, time: 0 }).run(); const app = createApp(ctx);
  await app.handle(new Request(`http://x/videos/${id}/analysis`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(parseAiAnalysisOptions(undefined)) })); await ctx.analysisQueue.idle();
  const rows = await (await app.handle(new Request(`http://x/videos/${id}/candidates`))).json();
  expect(rows).toHaveLength(1); expect(rows[0].score).toBeNull(); db.raw.close();
});
