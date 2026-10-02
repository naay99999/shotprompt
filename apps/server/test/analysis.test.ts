import { expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { analysisRuns, candidateFeedback, candidates, jobs, videos } from '@shotprompt/db';
import { parseAiAnalysisOptions } from '@shotprompt/core';
import { saveProviderConfig, parseProviderConfig } from '../src/ai/provider-settings';
import { createTestApp } from './helpers/app';
import { createReadyVideo } from './helpers/fixtures';
const post = (url: string, body: unknown) => new Request(`http://x${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
it('creates analysis with defaults and refuses duplicate jobs and malformed options', async () => {
  const { db, app } = createTestApp(); createReadyVideo(db, { duration: 60 }); saveProviderConfig(db, parseProviderConfig({ model: 'test' }));
  expect((await app.handle(post('/videos/v1/analysis', { schemaVersion: 2, maxDuration: 181 }))).status).toBe(400);
  const response = await app.handle(post('/videos/v1/analysis', parseAiAnalysisOptions(undefined))); expect(response.status).toBe(202);
  const body = await response.json(); expect(body.runId).toBeString(); expect(body.jobId).toBeString();
  const conflict = await app.handle(post('/videos/v1/analysis', parseAiAnalysisOptions(undefined))); expect(conflict.status).toBe(409); expect((await conflict.json()).jobId).toBe(body.jobId);
  const repair = await app.handle(post('/videos/v1/repair', {})); expect(repair.status).toBe(409); expect((await repair.json()).jobId).toBe(body.jobId);
  expect(db.select().from(videos).get()?.status).toBe('ready');
  const runs = await (await app.handle(new Request('http://x/videos/v1/analysis'))).json(); expect(runs.history).toHaveLength(1);
  db.raw.close();
});
it('candidate reads reject cross-video run IDs and feedback enforces ownership', async () => {
  const { db, app } = createTestApp(); createReadyVideo(db, { duration: 60 }); createReadyVideo(db, { id: 'v2', duration: 60 });
  db.insert(analysisRuns).values({ id: 'r2', videoId: 'v2', jobId: 'j2', status: 'done', optionsJson: '{}', engineVersion: 'rules-v1', sourceRevision: 'x', createdAt: 1 }).run();
  expect((await app.handle(new Request('http://x/videos/v1/candidates?runId=r2'))).status).toBe(404);
  db.insert(candidates).values({ id: 'c2', videoId: 'v2', start: 0, end: 10, score: 42 }).run();
  const feedback = new Request('http://x/videos/v1/candidates/c2/feedback', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ verdict: 'good' }) });
  expect((await app.handle(feedback)).status).toBe(404); expect(db.select().from(candidateFeedback).all()).toHaveLength(0);
  db.raw.close();
});
it('video deletion blocks every active job, even if a newer job has completed', async () => {
  const { db, app } = createTestApp(); createReadyVideo(db, { duration: 60 });
  db.insert(jobs).values([{ id: 'old', videoId: 'v1', type: 'analysis', status: 'running', createdAt: 1 }, { id: 'new', videoId: 'v1', type: 'export', status: 'done', createdAt: 2 }]).run();
  expect((await app.handle(new Request('http://x/videos/v1', { method: 'DELETE' }))).status).toBe(409);
  expect(db.select().from(videos).where(eq(videos.id, 'v1')).get()).toBeDefined(); db.raw.close();
});
it('limits history to 20 while retaining an older active run, and feedback can be replaced and cleared', async () => {
  const { db, app } = createTestApp(); createReadyVideo(db, { duration: 60 });
  db.insert(analysisRuns).values(Array.from({ length: 25 }, (_, n) => ({ id: `r${n}`, videoId: 'v1', jobId: `j${n}`, status: 'done', optionsJson: '{}', engineVersion: 'rules-v1', sourceRevision: 'x', createdAt: n }))).run();
  db.update(videos).set({ activeAnalysisRunId: 'r0' }).run();
  const body = await (await app.handle(new Request('http://x/videos/v1/analysis'))).json();
  expect(body.history).toHaveLength(20); expect(body.active.id).toBe('r0'); expect(body.latest.id).toBe('r24');
  db.insert(candidates).values([{ id: 'winner', videoId: 'v1', runId: 'r0', start: 0, end: 10, score: 80 }, { id: 'hidden', videoId: 'v1', runId: 'r0', start: 1, end: 10, score: 50, isPrimary: false }]).run();
  expect((await (await app.handle(new Request('http://x/videos/v1/candidates'))).json()).map((r: { id: string }) => r.id)).toEqual(['winner']);
  expect(await (await app.handle(new Request('http://x/videos/v1/candidates?includeSuppressed=true'))).json()).toHaveLength(2);
  for (const verdict of ['good', 'irrelevant']) expect((await app.handle(new Request('http://x/videos/v1/candidates/winner/feedback', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ verdict }) }))).status).toBe(200);
  expect(db.select().from(candidateFeedback).get()?.verdict).toBe('irrelevant');
  expect((await app.handle(new Request('http://x/videos/v1/candidates/winner/feedback', { method: 'DELETE' }))).status).toBe(200); expect(db.select().from(candidateFeedback).all()).toHaveLength(0); db.raw.close();
});
