import { expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createDb, videos, jobs, segments, analysisRuns, candidates, clips, candidateFeedback } from '@shotprompt/db';
import { parseAiAnalysisOptions } from '@shotprompt/core';
import { createCtx } from '../src/context';
import { createApp } from '../src/app';
import { defaultAnalysisRuntime } from '../src/analysis-service';
import { PIPELINE_STEPS } from '../src/pipeline';
import { parseProviderConfig, saveProviderConfig } from '../src/ai/provider-settings';
import { fixtureModelResponse } from './helpers/ai-fixtures';
it('real HTTP pipeline, acceptance, reanalysis, failure and cancellation preserve original provenance', async () => {
  let invalid = false, blocking = false, entered!: () => void;
  let started = new Promise<void>(resolve => { entered = resolve; });
  const seen: string[] = [];
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
    const body = await request.json(); seen.push(body.model);
    if (blocking) { entered(); await new Promise(resolve => setTimeout(resolve, 150)); }
    const value = invalid ? {} : fixtureModelResponse({ messages: body.messages, schema: {}, maxOutputTokens: 4096 }).value;
    return Response.json({ model: body.model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 100, completion_tokens: 30 } });
  } });
  const db = createDb(':memory:');
  try {
    const config = parseProviderConfig({ protocol: 'openai-compatible', baseUrl: `http://127.0.0.1:${server.port}/v1`, model: 'first' }); saveProviderConfig(db, config);
    db.insert(videos).values({ id: 'v', filename: 'fixture.mp4', path: '/tmp/fixture.mp4', status: 'uploaded', language: 'th', duration: 60, analysisOptionsJson: JSON.stringify(parseAiAnalysisOptions(undefined)), createdAt: 1 }).run();
    db.insert(segments).values([{ videoId: 'v', start: 0, end: 20, text: 'ข้อผิดพลาดและวิธีแก้' }, { videoId: 'v', start: 20, end: 40, text: 'An example and explanation.' }, { videoId: 'v', start: 40, end: 60, text: 'これは具体例と結論です。' }]).run();
    db.insert(jobs).values({ id: 'pipeline', videoId: 'v', type: 'pipeline', status: 'queued', createdAt: 1 }).run();
    const ctx = createCtx(db, { pipelineSteps: Object.fromEntries(PIPELINE_STEPS.map(name => [name, { satisfied: () => false, run: async () => {} }])), analysisRuntime: { ...defaultAnalysisRuntime, thumbnails: async (_v, _r, rows) => rows.map(row => ({ ...row, id: crypto.randomUUID(), thumbnailPath: '/tmp/fixture.jpg' })), cleanup: async () => {} } });
    const migrated = ctx.profiles.list().profiles[0];
    if (migrated) { ctx.profiles.recordCheck(migrated.id, migrated.revision, { fingerprint: ctx.profiles.fingerprint(ctx.profiles.get(migrated.id)), revision: migrated.revision, status: 'ready', checkedAt: 1, errorCode: null }); ctx.profiles.activate(migrated.id, migrated.revision); }
    const app = createApp(ctx);
    const call = (path: string, method = 'GET', body?: unknown) => app.handle(new Request(`http://x${path}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) }));
    ctx.pipelineQueue.enqueue('pipeline'); await ctx.pipelineQueue.idle(); await ctx.analysisQueue.idle();
    expect(db.select().from(videos).get()?.status).toBe('ready');
    const original = await (await call('/videos/v/candidates')).json(); expect(original).toHaveLength(1); expect(original[0].score).toBe(80);
    expect((await call(`/videos/v/candidates/${original[0].id}/feedback`, 'PUT', { verdict: 'good' })).status).toBe(200);
    const accepted = await (await call('/videos/v/clips', 'POST', { candidateId: original[0].id })).json();
    expect(accepted.assessment.evaluatorMetadata.snapshot.provider.model).toBe('first');
    const updatedProfile = ctx.profiles.update(migrated!.id, { expectedRevision: migrated!.revision, draft: { name: migrated!.name, presetId: migrated!.presetId, config: { ...migrated!.config, model: 'second' } }, credential: { action: 'keep' } });
    ctx.profiles.recordCheck(updatedProfile.id, updatedProfile.revision, { fingerprint: ctx.profiles.fingerprint(ctx.profiles.get(updatedProfile.id)), revision: updatedProfile.revision, status: 'ready', checkedAt: 2, errorCode: null });
    ctx.profiles.activate(updatedProfile.id, updatedProfile.revision);
    expect((await call('/videos/v/analysis', 'POST', parseAiAnalysisOptions({ instruction: 'อธิบายพร้อมตัวอย่าง' }))).status).toBe(202); await ctx.analysisQueue.idle();
    const active = db.select().from(videos).get()!.activeAnalysisRunId;
    expect(seen).toContain('second'); expect((await (await call('/videos/v/clips')).json())[0].assessment).toEqual(accepted.assessment);
    invalid = true; await call('/videos/v/analysis', 'POST', parseAiAnalysisOptions(undefined)); await ctx.analysisQueue.idle();
    expect(db.select().from(videos).get()!.activeAnalysisRunId).toBe(active); expect(db.select().from(analysisRuns).all().filter(r => r.status === 'failed')).toHaveLength(1);
    expect(db.select().from(candidates).all()).toHaveLength(2);
    invalid = false; blocking = true; const pending = await (await call('/videos/v/analysis', 'POST', parseAiAnalysisOptions(undefined))).json(); await started;
    expect((await call(`/jobs/${pending.jobId}/cancel`, 'POST')).status).toBe(200); await ctx.analysisQueue.idle();
    expect(db.select().from(videos).get()!.activeAnalysisRunId).toBe(active);
    expect(db.select().from(analysisRuns).where(eq(analysisRuns.id, pending.runId)).get()?.status).toBe('canceled');
    expect((await call('/videos/v', 'DELETE')).status).toBe(200);
    for (const table of [analysisRuns, candidates, clips, candidateFeedback]) expect(db.select().from(table).all()).toHaveLength(0);
  } finally { server.stop(true); db.raw.close(); }
});
