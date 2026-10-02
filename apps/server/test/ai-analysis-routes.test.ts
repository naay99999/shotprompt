import { expect, it } from 'bun:test';
import { videos } from '@shotprompt/db';
import { createTestApp } from './helpers/app';
import { parseAiAnalysisOptions } from '@shotprompt/core';
import { parseProviderConfig, saveProviderConfig } from '../src/ai/provider-settings';
it('accepts AI options only with configured provider and returns blocking job IDs', async () => {
  const { app, db } = createTestApp(); db.insert(videos).values({ id: 'v', filename: 'test', path: '/test', duration: 80, language: 'th', status: 'ready', createdAt: 1 }).run();
  const post = (body: unknown) => app.handle(new Request('http://x/videos/v/analysis', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  expect((await post(parseAiAnalysisOptions(undefined))).status).toBe(409);
  saveProviderConfig(db, parseProviderConfig({ model: 'test' }));
  expect((await post({ categories: ['sales'], goal: 'sell' })).status).toBe(400);
  const response = await post(parseAiAnalysisOptions(undefined)); expect(response.status).toBe(202);
  const queued = await response.json(); const conflict = await post(parseAiAnalysisOptions(undefined));
  expect(conflict.status).toBe(409); expect((await conflict.json()).jobId).toBe(queued.jobId);
  const history = await (await app.handle(new Request('http://x/videos/v/analysis'))).json();
  expect(history.latest.options.schemaVersion).toBe(2); expect(history.latest.evaluatorMetadata.snapshot.provider.model).toBe('test'); db.raw.close();
});
