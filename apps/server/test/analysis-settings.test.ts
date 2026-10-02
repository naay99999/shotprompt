import { expect, it } from 'bun:test';
import { createTestApp } from './helpers/app';
import { createEvaluatorSnapshot, parseProviderConfig, readProviderConfig, saveProviderConfig } from '../src/ai/provider-settings';
export const localConfig = { protocol: 'openai-compatible', inferenceLocation: 'local', baseUrl: 'http://127.0.0.1:1234/v1', model: 'local-test', outputMode: 'schema', externalEnabled: false, requestTimeoutSeconds: 120, runTimeoutSeconds: 1800 };
it('keeps API protocol independent of local inference and validates endpoint opt-in', () => {
  for (const baseUrl of ['http://localhost:11434', 'http://192.168.1.5:1234/v1', 'http://[::1]:1234/v1', 'http://[fd00::1]:1234/v1']) expect(parseProviderConfig({ ...localConfig, baseUrl }).inferenceLocation).toBe('local');
  for (const baseUrl of ['https://example.com/v1', 'http://user:pass@localhost:1234', 'http://localhost:1234/v1?q=secret', 'http://localhost:1234/#x']) expect(() => parseProviderConfig({ ...localConfig, baseUrl })).toThrow();
  expect(() => parseProviderConfig({ ...localConfig, inferenceLocation: 'external', baseUrl: 'https://example.com/v1' })).toThrow();
  expect(parseProviderConfig({ ...localConfig, inferenceLocation: 'external', externalEnabled: true, baseUrl: 'https://example.com/v1' }).protocol).toBe('openai-compatible');
});
it('persists public settings without mutating queued snapshots and exposes no credential', async () => {
  const { db, app } = createTestApp();
  const config = parseProviderConfig(localConfig); saveProviderConfig(db, config);
  const snapshot = createEvaluatorSnapshot(readProviderConfig(db)!);
  saveProviderConfig(db, { ...config, model: 'changed' });
  expect(snapshot.provider.model).toBe('local-test');
  const response = await app.handle(new Request('http://x/settings/analysis'));
  expect(response.status).toBe(200);
  const json = await response.json(); expect(json.config.model).toBe('changed'); expect(json).not.toHaveProperty('apiKey');
  const invalid = await app.handle(new Request('http://x/settings/analysis', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...localConfig, runTimeoutSeconds: 60 }) }));
  expect(invalid.status).toBe(400); db.raw.close();
});
