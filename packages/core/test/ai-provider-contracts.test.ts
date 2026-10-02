import { expect, it } from 'bun:test';
const api: any = await import('../src/ai-provider-presets').catch(() => ({}));

it('provides the five exact provider defaults and keeps protocol separate from location', () => {
  const presets = api.getProviderPresets();
  expect(presets.map((row: { id: string }) => row.id)).toEqual(['openrouter', 'gemini', 'ollama', 'local-compatible', 'custom']);
  expect(api.createProfileDraft('openrouter').config.baseUrl).toBe('https://openrouter.ai/api/v1');
  expect(api.createProfileDraft('openrouter').config.protocol).toBe('openai-compatible');
  expect(api.createProfileDraft('gemini').config.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
  expect(api.createProfileDraft('ollama').config.baseUrl).toBe('http://127.0.0.1:11434');
  expect(api.createProfileDraft('local-compatible').config.inferenceLocation).toBe('local');
  expect(api.createProfileDraft('custom').config.model).toBe('');
});

it('allows an incomplete draft while keeping credential input an explicit operation', () => {
  const draft = api.createProfileDraft('openrouter');
  const parsed = api.parseProfileWrite({ draft, credential: { action: 'keep' } });
  expect(parsed.draft.config.model).toBe('');
  expect(parsed.credential).toEqual({ action: 'keep' });
  expect(api.parseProfileWrite({ draft, credential: { action: 'replace', key: ' key ' } }).credential).toEqual({ action: 'replace', key: 'key' });
  expect(api.parseProfileWrite({ draft, credential: { action: 'remove' } }).credential).toEqual({ action: 'remove' });
});

it('rejects invalid names, secrets, unknown providers and endpoint/timeout mismatches', () => {
  const draft = api.createProfileDraft('openrouter');
  for (const name of ['', 'x'.repeat(81)]) expect(() => api.parseProfileWrite({ draft: { ...draft, name }, credential: { action: 'keep' } })).toThrow();
  for (const key of [' ', 'x'.repeat(4097), 'x\r\ny']) expect(() => api.parseProfileWrite({ draft, credential: { action: 'replace', key } })).toThrow();
  expect(() => api.createProfileDraft('missing' as never)).toThrow();
  expect(() => api.parseProfileWrite({ draft: { ...draft, config: { ...draft.config, baseUrl: 'https://name:password@openrouter.ai/api/v1' } }, credential: { action: 'keep' } })).toThrow();
  expect(() => api.parseProfileWrite({ draft: { ...draft, presetId: 'ollama', config: { ...draft.config, inferenceLocation: 'local', baseUrl: 'https://public.example/v1' } }, credential: { action: 'keep' } })).toThrow();
  expect(() => api.parseProfileWrite({ draft: { ...draft, config: { ...draft.config, requestTimeoutSeconds: 120, runTimeoutSeconds: 60 } }, credential: { action: 'keep' } })).toThrow();
});

it('requires complete config, cloud credentials and external transcript consent only at activation', () => {
  const draft = api.createProfileDraft('openrouter');
  expect(() => api.validateRuntimeProfile({ ...draft, credentialMode: 'none' } as never)).toThrow();
  const configured = { ...draft, config: { ...draft.config, model: 'openai/gpt-test', externalEnabled: true } };
  expect(api.validateRuntimeProfile({ ...configured, credentialMode: 'stored' } as never).model).toBe('openai/gpt-test');
  expect(() => api.validateRuntimeProfile({ ...configured, config: { ...configured.config, externalEnabled: false }, credentialMode: 'stored' } as never)).toThrow();
  const local = api.createProfileDraft('ollama');
  expect(() => api.validateRuntimeProfile({ ...local, config: { ...local.config, model: 'llama' }, credentialMode: 'none' } as never)).not.toThrow();
});
