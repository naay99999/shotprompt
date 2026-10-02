import { expect, it } from 'bun:test';
import { initialProviderState, reduceProviderState } from '../lib/analysis-settings-state';
const config = { protocol: 'ollama' as const, inferenceLocation: 'local' as const, baseUrl: 'http://127.0.0.1:11434', model: 'test', outputMode: 'schema' as const, externalEnabled: false, requestTimeoutSeconds: 120, runTimeoutSeconds: 1800 };
it('invalidates a connection check when settings are edited and ignores late loads', () => {
  let state = reduceProviderState(initialProviderState, { type: 'load-start', requestId: 2 });
  state = reduceProviderState(state, { type: 'load-success', requestId: 2, data: { config, defaults: config, keyPresent: false, check: { fingerprint: 'original', status: 'ready', checkedAt: 1, errorCode: null } } });
  state = reduceProviderState(state, { type: 'edit', config: { ...config, model: 'new-model' } });
  expect(state.check).toBeNull(); expect(state.dirty).toBe(true);
  expect(reduceProviderState(state, { type: 'load-success', requestId: 1, data: { config, defaults: config, keyPresent: false, check: null } })).toBe(state);
  state = reduceProviderState(state, { type: 'load-success', requestId: 2, data: { config, defaults: config, keyPresent: false, check: null } });
  expect(state.config?.model).toBe('new-model');
});
