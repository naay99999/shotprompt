import { expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createDb, aiCredentials, analysisRuns, settings } from '@shotprompt/db';
import { createProfileDraft, parseProfileWrite, type ConnectionSnapshot } from '@shotprompt/core';
import { createCredentialVault } from '../src/ai/credential-vault';
const profilesModule: any = await import('../src/ai/provider-profiles').catch(() => ({}));
const createProfileService = profilesModule.createProfileService;
import { parseProviderConfig, saveProviderConfig } from '../src/ai/provider-settings';

function setup(options: { key?: string; old?: boolean } = {}) {
  const db = createDb(':memory:'), secretsDir = `/private/tmp/shotprompt-profile-${crypto.randomUUID()}`;
  if (options.old) saveProviderConfig(db, parseProviderConfig({ model: 'old-model' }));
  const vault = createCredentialVault({ secretsDir, hasCredentials: () => db.select().from(aiCredentials).all().length > 0 });
  const service = createProfileService(db, vault, { legacyKey: () => options.key });
  return { db, service, secretsDir, close: async () => { db.raw.close(); await Bun.$`rm -rf ${secretsDir}`.quiet(); } };
}
function write(preset = 'openrouter', name?: string, key?: string) {
  const draft = createProfileDraft(preset as never); if (name) draft.name = name;
  if (preset === 'openrouter' || preset === 'gemini') draft.config.externalEnabled = true;
  draft.config.model = `${preset}-model`;
  return parseProfileWrite({ draft, credential: key ? { action: 'replace', key } : { action: 'keep' } });
}

it('creates draft profiles, enforces the twenty-profile cap and never returns secrets or ciphertext', async () => {
  const t = setup();
  try {
    for (let i = 0; i < 20; i++) t.service.create(write('custom', `profile-${i}`, `secret-${i}`));
    expect(t.service.list().profiles).toHaveLength(20);
    expect(() => t.service.create(write('custom', 'twenty-first'))).toThrow('profile-limit');
    const rendered = JSON.stringify(t.service.list());
    expect(rendered).not.toContain('secret-'); expect(rendered).not.toContain('ciphertext');
    expect(t.db.select().from(aiCredentials).all()).toHaveLength(20);
  } finally { await t.close(); }
});

it('keeps, replaces and removes credentials explicitly while revisions invalidate checks', async () => {
  const t = setup();
  try {
    const created = t.service.create(write('openrouter', 'Router A', 'first-secret'));
    const createdFull = t.service.get(created.id);
    const connection = t.service.snapshot(createdFull);
    expect(t.service.resolveCredential({ provider: created.config, connection } as never)).toBe('first-secret');
    const updated = t.service.update(created.id, { ...write('openrouter', 'Router A'), expectedRevision: created.revision });
    expect(t.service.get(updated.id).credentialVersion).toBe(createdFull.credentialVersion);
    expect(t.service.resolveCredential({ provider: updated.config, connection } as never)).toBe('first-secret');
    expect(updated.check).toBeNull();
    const updatedVersion = t.service.get(updated.id).credentialVersion;
    const replaced = t.service.update(created.id, { ...write('openrouter', 'Router A', 'second-secret'), expectedRevision: updated.revision });
    expect(t.service.get(replaced.id).credentialVersion).not.toBe(updatedVersion);
    expect(() => t.service.resolveCredential({ provider: updated.config, connection } as never)).toThrow();
    expect(t.service.resolveCredential({ provider: replaced.config, connection: t.service.snapshot(t.service.get(replaced.id)) } as never)).toBe('second-secret');
    expect(() => t.service.update(created.id, { ...write('gemini', 'Moved'), expectedRevision: replaced.revision })).toThrow('credential-operation-required');
    expect(t.db.select().from(aiCredentials).all()).toHaveLength(1);
    const removed = t.service.update(created.id, { ...write('openrouter', 'Router A'), credential: { action: 'remove' }, expectedRevision: replaced.revision });
    expect(removed.credentialMode).toBe('none'); expect(t.db.select().from(aiCredentials).all()).toHaveLength(0);
    expect(() => t.service.update(created.id, { ...write('openrouter'), expectedRevision: replaced.revision })).toThrow('profile-revision-conflict');
  } finally { await t.close(); }
});

it('imports old settings once, never copies environment credentials and requires a new check', async () => {
  const t = setup({ old: true, key: 'legacy-environment-key' });
  try {
    t.service.migrateLegacy(); const first = t.service.list(), legacy = first.profiles[0];
    expect(first.activeProfileId).toBe(legacy.id); expect(legacy.credentialMode).toBe('legacy-env'); expect(legacy.config.model).toBe('old-model'); expect(legacy.check).toBeNull(); expect(first.migrationNotice).toBe(true);
    expect(JSON.stringify(first)).not.toContain('legacy-environment-key'); expect(t.db.select().from(aiCredentials).all()).toHaveLength(0);
    t.service.recordCheck(legacy.id, legacy.revision, { fingerprint: t.service.fingerprint(t.service.get(legacy.id)), revision: legacy.revision, status: 'failed', checkedAt: 1, errorCode: 'provider-credentials' });
    expect(t.service.list().migrationNotice).toBe(false);
    t.service.remove(legacy.id, legacy.revision); t.service.migrateLegacy(); expect(t.service.list().profiles).toHaveLength(0);
    expect(t.db.select().from(settings).all().some(row => row.key === 'analysisProvider')).toBe(false);
  } finally { await t.close(); }
});

it('uses each profile credential, blocks live endpoint/key edits and deletion, and preserves queued snapshots', async () => {
  const t = setup();
  try {
    const a = t.service.create(write('openrouter', 'Router A', 'key-A'));
    const aFull = t.service.get(a.id);
    const aSnapshot = t.service.snapshot(aFull);
    const runId = crypto.randomUUID();
    t.db.insert(analysisRuns).values({ id: runId, videoId: 'video', jobId: 'job', status: 'queued', optionsJson: '{}', engineVersion: 'llm-v1', sourceRevision: 'rev', createdAt: 1, evaluatorMetadataJson: JSON.stringify({ snapshot: { connection: aSnapshot } }) }).run();
    const b = t.service.create(write('gemini', 'Gemini B', 'key-B'));
    const bFull = t.service.get(b.id);
    const bFingerprint = t.service.fingerprint(bFull);
    t.service.recordCheck(b.id, b.revision, { status: 'ready', checkedAt: 1, latencyMs: 5, model: b.config.model, fingerprint: bFingerprint, revision: b.revision });
    t.service.activate(b.id, b.revision);
    expect(t.service.resolveCredential({ provider: a.config, connection: aSnapshot } as never)).toBe('key-A');
    expect(t.service.resolveCredential({ provider: b.config, connection: t.service.snapshot(t.service.get(b.id)) } as never)).toBe('key-B');
    expect(() => t.service.update(a.id, { ...write('openrouter', 'Moved', 'key-A2'), expectedRevision: a.revision })).toThrow('profile-in-use');
    expect(() => t.service.update(a.id, { ...write('gemini', 'Moved'), expectedRevision: a.revision })).toThrow('profile-in-use');
    expect(() => t.service.remove(a.id, a.revision)).toThrow('profile-in-use');
    const renamed = t.service.update(a.id, { ...write('openrouter', 'Still A'), expectedRevision: a.revision });
    expect(renamed.config.model).toBe(a.config.model);
    expect(t.db.select().from(analysisRuns).where(eq(analysisRuns.id, runId)).get()?.evaluatorMetadataJson).toContain(a.id); expect(t.db.select().from(analysisRuns).where(eq(analysisRuns.id, runId)).get()?.evaluatorMetadataJson).not.toContain('key-A');
  } finally { await t.close(); }
});

it('fails closed when the vault master key is lost and does not use env keys for new profiles', async () => {
  const t = setup({ key: 'global-env-secret' });
  try {
    const created = t.service.create(write('openrouter', 'Router A', 'stored-key'));
    const full = t.service.get(created.id);
    t.service.recordCheck(created.id, created.revision, { status: 'ready', checkedAt: 1, latencyMs: 5, model: created.config.model, fingerprint: t.service.fingerprint(full), revision: created.revision });
    t.service.activate(created.id, created.revision);
    expect(t.service.resolveCredential({ provider: created.config, connection: t.service.snapshot(full) } as never)).toBe('stored-key');
    await Bun.$`rm ${t.secretsDir}/ai-vault.key`.quiet();
    expect(() => t.service.resolveCredential({ provider: created.config, connection: t.service.snapshot(full) } as never)).toThrow('credential-vault-unavailable');
    expect(t.service.list().profiles[0].vaultAvailable).toBe(false);
    expect(() => t.service.activeReady()).toThrow('credential-vault-unavailable');
    expect(t.db.select().from(aiCredentials).all()).toHaveLength(1);
  } finally { await t.close(); }
});
