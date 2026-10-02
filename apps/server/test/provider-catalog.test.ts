import { expect, it } from 'bun:test';
import { createDb, aiCredentials } from '@shotprompt/db';
import { createProfileDraft, parseProfileWrite } from '@shotprompt/core';
import { createCredentialVault } from '../src/ai/credential-vault';
import { createProfileService } from '../src/ai/provider-profiles';
import { createModelCatalogService, normalizeModelCatalog } from '../src/ai/provider-catalog';

function setup(fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>, now = () => 1000) {
  const db = createDb(':memory:'), secretsDir = `/private/tmp/shotprompt-catalog-${crypto.randomUUID()}`;
  const vault = createCredentialVault({ secretsDir, hasCredentials: () => db.select().from(aiCredentials).all().length > 0 });
  const profiles = createProfileService(db, vault, { legacyKey: () => undefined });
  const draft = createProfileDraft('openrouter'); draft.config.externalEnabled = true; draft.config.model = 'openai/gpt-4.1-mini';
  const profile = profiles.create(parseProfileWrite({ draft, credential: { action: 'replace', key: 'catalog-secret' } }));
  const service = createModelCatalogService(profiles, { fetch, now });
  return { db, secretsDir, profiles, profile, service, close: async () => { db.raw.close(); await Bun.$`rm -rf ${secretsDir}`.quiet(); } };
}

it('normalizes OpenRouter prices, preserves explicit zero and leaves unsupported metadata unknown', () => {
  const rows = normalizeModelCatalog('openrouter', { data: [
    { id: 'x/paid', name: 'Paid', context_length: 8192, pricing: { prompt: '0.000002', completion: '0.000003' }, architecture: { modality: 'text->text' }, supported_parameters: ['structured_outputs'] },
    { id: 'x/free', pricing: { prompt: '0', completion: 'NaN' } },
  ] });
  expect(rows[0]).toMatchObject({ inputUsdPerMillion: 2, outputUsdPerMillion: 3, contextLength: 8192, textCapability: 'supported', schemaSupport: 'supported' });
  expect(rows[1]).toMatchObject({ inputUsdPerMillion: 0, outputUsdPerMillion: null, schemaSupport: 'unknown', textCapability: 'unknown' });
  expect(normalizeModelCatalog('openrouter', { data: [
    { id: 'x/image', architecture: { modality: 'text->image' } },
    { id: 'x/output-image', architecture: { input_modalities: ['text'], output_modalities: ['image'] } },
    { id: 'x/unknown-price', pricing: { prompt: ' ', completion: '' } },
  ] })).toEqual([expect.objectContaining({ id: 'x/unknown-price', inputUsdPerMillion: null, outputUsdPerMillion: null })]);
});

it('uses the native tags endpoint for a Custom profile configured with Ollama', async () => {
  const t = setup(async input => { expect(String(input)).toBe('http://127.0.0.1:11434/api/tags'); return Response.json({ models: [{ name: 'qwen:latest' }] }); });
  try {
    const updated = t.profiles.update(t.profile.id, { expectedRevision: t.profile.revision, draft: { name: t.profile.name, presetId: 'custom', config: { ...t.profile.config, presetId: 'custom', protocol: 'ollama', inferenceLocation: 'local', externalEnabled: false, baseUrl: 'http://127.0.0.1:11434' } }, credential: { action: 'replace', key: 'catalog-secret' } });
    const catalog = await t.service.load(updated.id, updated.revision);
    expect(catalog.entries[0].id).toBe('qwen:latest');
  } finally { await t.close(); }
});

it('omits catalog fields that echo the resolved API key', async () => {
  const t = setup(async () => Response.json({ data: [
    { id: 'catalog-secret', name: 'Public model' },
    { id: 'safe/model', name: 'catalog-secret' },
    { id: 'safe/visible', name: 'Visible model' },
  ] }));
  try {
    const catalog = await t.service.load(t.profile.id, t.profile.revision);
    expect(catalog.entries.map(row => row.id)).toEqual(['safe/visible']);
    expect(JSON.stringify(catalog)).not.toContain('catalog-secret');
  } finally { await t.close(); }
});

it('uses the profile key, coalesces fresh catalog reads and returns stale entries after a failed refresh', async () => {
  let calls = 0, time = 1000;
  const t = setup(async (_input, init) => {
    calls++;
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer catalog-secret');
    if (calls > 1) throw new Error('provider echoed catalog-secret');
    return Response.json({ data: [{ id: 'x/model', pricing: { prompt: '0', completion: '0.000001' }, supported_parameters: ['response_format'] }] });
  }, () => time);
  try {
    const [first, coalesced] = await Promise.all([t.service.load(t.profile.id, t.profile.revision), t.service.load(t.profile.id, t.profile.revision)]);
    expect(calls).toBe(1); expect(coalesced.entries).toEqual(first.entries);
    time += 5 * 60 * 1000 + 1;
    const stale = await t.service.load(t.profile.id, t.profile.revision, true);
    expect(stale).toMatchObject({ stale: true, errorCode: 'provider-catalog-unavailable', entries: [{ id: 'x/model', inputUsdPerMillion: 0 }] });
    expect(JSON.stringify(stale)).not.toContain('catalog-secret');
    expect(() => t.service.load(t.profile.id, t.profile.revision - 1)).toThrow();
  } finally { await t.close(); }
});

it('bounds catalog bodies, rejects cross-origin pagination and fails without cached data', async () => {
  const oversized = setup(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 1)); controller.close(); } })));
  try { await expect(oversized.service.load(oversized.profile.id, oversized.profile.revision)).rejects.toThrow('provider-catalog-too-large'); }
  finally { await oversized.close(); }
  const paginated = setup(async () => Response.json({ data: [{ id: 'x' }], next: 'https://evil.example/models?page=2' }));
  try { await expect(paginated.service.load(paginated.profile.id, paginated.profile.revision)).rejects.toThrow('provider-catalog-unavailable'); }
  finally { await paginated.close(); }
});

it('marks a catalog truncated only when another usable entry exceeds the output bound', async () => {
  const t = setup(async () => Response.json({ data: [
    ...Array.from({ length: 3000 }, (_, index) => ({ id: `x/${index}` })),
    { id: 'x/tail' },
  ] }));
  try {
    const catalog = await t.service.load(t.profile.id, t.profile.revision);
    expect(catalog.entries).toHaveLength(3000);
    expect(catalog.truncated).toBe(true);
  } finally { await t.close(); }
});
