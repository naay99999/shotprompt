import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { aiCredentials, analysisRuns, settings, type DB } from '@shotprompt/db';
import { AiProviderError, createProfileDraft, getProviderPresets, isProfileView, parseProfileWrite, validateRuntimeProfile, type ConnectionSnapshot, type CredentialMode, type CredentialScope, type EvaluatorSnapshot, type ProfileCheck, type ProfileDraft, type ProfileView, type ProviderProfile, type ProviderRegistry } from '@shotprompt/core';
import { createEvaluatorSnapshot, parseProviderConfig, type ProviderCheck } from './provider-settings';
import { getSetting, setSetting } from '../env';
import type { CredentialVault, EncryptedCredential } from './credential-vault';
const REGISTRY_KEY = 'analysisProviderProfiles';
const MIGRATION_PROFILE_KEY = 'analysisProviderMigrationProfile';
const fail = (code: string): never => { throw new AiProviderError(code); };
export interface ProfileService {
  migrateLegacy(): void;
  list(): { schemaVersion: 1; activeProfileId: string | null; profiles: ProfileView[]; migrationNotice: boolean };
  create(value: unknown): ProfileView;
  update(id: string, value: unknown): ProfileView;
  remove(id: string, expectedRevision: number): void;
  get(id: string): ProviderProfile;
  resolveCredential(snapshot: EvaluatorSnapshot): string | undefined;
  fingerprint(profile: ProviderProfile): string;
  recordCheck(id: string, expectedRevision: number, check: ProfileCheck): ProfileView;
  activate(id: string | null, expectedRevision?: number): void;
  activeReady(): ProviderProfile | null;
  snapshot(profile: ProviderProfile): ConnectionSnapshot;
}
function presetForConfig(config: ProviderProfile['config']): ProviderProfile['presetId'] {
  const preset = getProviderPresets().find(p => p.baseUrl === config.baseUrl && p.protocol === config.protocol && p.inferenceLocation === config.inferenceLocation);
  return preset?.id ?? 'custom';
}
function registryFrom(db: DB): ProviderRegistry {
  const raw = getSetting(db, REGISTRY_KEY, ''); if (!raw) return { schemaVersion: 1, activeProfileId: null, profiles: [] };
  try {
    const value = JSON.parse(raw) as ProviderRegistry;
    if (value.schemaVersion !== 1 || !Array.isArray(value.profiles) || value.profiles.length > 20 || !(value.activeProfileId === null || value.profiles.some(p => p.id === value.activeProfileId))) return fail('invalid-profile-registry');
    return value;
  } catch (error) { if (error instanceof AiProviderError) throw error; return fail('invalid-profile-registry'); }
}
function scopeOf(profile: Pick<ProviderProfile, 'id' | 'credentialVersion' | 'config'>): CredentialScope {
  if (!profile.credentialVersion) return fail('provider-credentials');
  return { profileId: profile.id, credentialVersion: profile.credentialVersion, protocol: profile.config.protocol, baseUrl: profile.config.baseUrl };
}
function visible(profile: ProviderProfile, keyPresent: boolean, vaultAvailable: boolean): ProfileView {
  const { credentialVersion: _credentialVersion, ...safe } = profile;
  return { ...safe, keyPresent, vaultAvailable };
}
function hasLiveRun(db: DB, profileId: string): boolean {
  return db.select().from(analysisRuns).where(inArray(analysisRuns.status, ['queued', 'running'])).all().some(run => {
    try { return JSON.parse(run.evaluatorMetadataJson ?? '{}').snapshot?.connection?.profileId === profileId; }
    catch { return (run.evaluatorMetadataJson ?? '').includes(profileId); }
  });
}
export function createProfileService(db: DB, vault: CredentialVault, options: { legacyKey: () => string | undefined; now?: () => number }): ProfileService {
  const now = options.now ?? Date.now;
  const store = (registry: ProviderRegistry) => setSetting(db, REGISTRY_KEY, JSON.stringify(registry));
  function current(): ProviderRegistry { return registryFrom(db); }
  function find(id: string): ProviderProfile { const profile = current().profiles.find(p => p.id === id); return profile ?? fail('profile-not-found'); }
  function keyPresent(profile: ProviderProfile): boolean {
    if (profile.credentialMode === 'legacy-env') return !!options.legacyKey();
    return profile.credentialMode === 'stored' && !!profile.credentialVersion && !!db.select().from(aiCredentials).where(eq(aiCredentials.id, profile.credentialVersion)).get();
  }
  function clean(profile: ProviderProfile): ProfileView { return visible(profile, keyPresent(profile), vault.available()); }
  function replaceCredential(profileId: string, config: ProfileDraft['config'], operation: ReturnType<typeof parseProfileWrite>['credential'], old?: ProviderProfile): Pick<ProviderProfile, 'credentialMode' | 'credentialVersion'> {
    if (operation.action === 'keep') {
      if (old) return { credentialMode: old.credentialMode, credentialVersion: old.credentialVersion };
      return { credentialMode: 'none', credentialVersion: null };
    }
    if (operation.action === 'remove') {
      if (old?.credentialVersion) db.delete(aiCredentials).where(eq(aiCredentials.id, old.credentialVersion)).run();
      return { credentialMode: 'none', credentialVersion: null };
    }
    const credentialVersion = randomUUID();
    const encrypted = vault.encrypt({ profileId, credentialVersion, protocol: config.protocol, baseUrl: config.baseUrl }, operation.key);
    db.insert(aiCredentials).values({ id: credentialVersion, profileId, version: encrypted.version, ciphertext: encrypted.ciphertext, nonce: encrypted.nonce, authTag: encrypted.authTag, createdAt: now() }).run();
    if (old?.credentialVersion) db.delete(aiCredentials).where(eq(aiCredentials.id, old.credentialVersion)).run();
    return { credentialMode: 'stored', credentialVersion };
  }
  function checkProfile(profile: ProviderProfile): ProviderProfile {
    return { ...profile, check: profile.check?.revision === profile.revision && profile.check.fingerprint === service.fingerprint(profile) ? profile.check : null };
  }
  const service: ProfileService = {
    migrateLegacy() {
      const legacy = getSetting(db, REGISTRY_KEY, ''); if (legacy) { registryFrom(db); return; }
      db.raw.transaction(() => {
        const currentRaw = getSetting(db, REGISTRY_KEY, ''); if (currentRaw) { registryFrom(db); return; }
        let registry: ProviderRegistry = { schemaVersion: 1, activeProfileId: null, profiles: [] };
        const oldRaw = getSetting(db, 'analysisProvider', '');
        if (oldRaw) {
          try {
            const config = parseProviderConfig(JSON.parse(oldRaw)), presetId = presetForConfig(config), id = randomUUID(), timestamp = now();
            const imported: ProviderProfile = { id, revision: 1, name: 'Existing connection', presetId, config: { ...config, presetId }, credentialMode: options.legacyKey() ? 'legacy-env' : 'none', credentialVersion: null, createdAt: timestamp, updatedAt: timestamp, check: null };
            registry = { schemaVersion: 1, activeProfileId: id, profiles: [imported] };
            setSetting(db, MIGRATION_PROFILE_KEY, id);
          } catch { /* Invalid legacy data produces an actionable empty setup state. */ }
          db.delete(settings).where(eq(settings.key, 'analysisProvider')).run();
          db.delete(settings).where(eq(settings.key, 'analysisProviderCheck')).run();
        }
        store(registry);
      })();
    },
    list() {
      const registry = current(), rows = registry.profiles.map(profile => clean(checkProfile(profile)));
      const migratedId = getSetting(db, MIGRATION_PROFILE_KEY, '');
      return { schemaVersion: 1, activeProfileId: registry.activeProfileId, profiles: rows, migrationNotice: !!migratedId && rows.some(p => p.id === migratedId && p.check === null) };
    },
    create(value) {
      const parsed = parseProfileWrite(value);
      return db.raw.transaction(() => {
        const registry = current(); if (parsed.expectedRevision !== undefined) fail('profile-revision-conflict'); if (registry.profiles.length >= 20) fail('profile-limit');
        const id = randomUUID(), timestamp = now(), credentials = replaceCredential(id, parsed.draft.config, parsed.credential);
        const profile: ProviderProfile = { ...parsed.draft, id, revision: 1, ...credentials, createdAt: timestamp, updatedAt: timestamp, check: null };
        store({ ...registry, profiles: [...registry.profiles, profile] }); return clean(profile);
      })();
    },
    update(id, value) {
      const parsed = parseProfileWrite(value);
      return db.raw.transaction(() => {
        const registry = current(), old = registry.profiles.find(p => p.id === id); if (!old) return fail('profile-not-found');
        if (parsed.expectedRevision !== old.revision) return fail('profile-revision-conflict');
        const destinationChanged = old.presetId !== parsed.draft.presetId || old.config.protocol !== parsed.draft.config.protocol || old.config.inferenceLocation !== parsed.draft.config.inferenceLocation || old.config.baseUrl !== parsed.draft.config.baseUrl;
        if (hasLiveRun(db, id) && (destinationChanged || parsed.credential.action !== 'keep')) return fail('profile-in-use');
        if (destinationChanged && old.credentialMode !== 'none' && parsed.credential.action === 'keep') return fail('credential-operation-required');
        const credentials = replaceCredential(id, parsed.draft.config, parsed.credential, old);
        const profile: ProviderProfile = { ...parsed.draft, id, revision: old.revision + 1, ...credentials, createdAt: old.createdAt, updatedAt: now(), check: null };
        store({ ...registry, profiles: registry.profiles.map(p => p.id === id ? profile : p) }); return clean(profile);
      })();
    },
    remove(id, expectedRevision) {
      db.raw.transaction(() => {
        const registry = current(), old = registry.profiles.find(p => p.id === id); if (!old) return fail('profile-not-found');
        if (old.revision !== expectedRevision) return fail('profile-revision-conflict');
        if (hasLiveRun(db, id)) return fail('profile-in-use');
        if (old.credentialVersion) db.delete(aiCredentials).where(eq(aiCredentials.id, old.credentialVersion)).run();
        if (getSetting(db, MIGRATION_PROFILE_KEY, '') === id) db.delete(settings).where(eq(settings.key, MIGRATION_PROFILE_KEY)).run();
        store({ ...registry, activeProfileId: registry.activeProfileId === id ? null : registry.activeProfileId, profiles: registry.profiles.filter(p => p.id !== id) });
      })();
    },
    get: find,
    resolveCredential(snapshot) {
      const connection = snapshot.connection; if (!connection) return snapshot.provider.presetId ? fail('profile-snapshot-invalid') : process.env.SHOTPROMPT_LLM_API_KEY;
      const profile = find(connection.profileId);
      if (profile.credentialMode !== connection.credentialMode || profile.credentialVersion !== connection.credentialVersion || profile.config.protocol !== snapshot.provider.protocol || profile.config.baseUrl !== snapshot.provider.baseUrl) return fail('provider-credentials');
      if (profile.credentialMode === 'legacy-env') return options.legacyKey() || fail('provider-credentials');
      if (profile.credentialMode === 'none') return undefined;
      const row = db.select().from(aiCredentials).where(and(eq(aiCredentials.id, connection.credentialVersion!), eq(aiCredentials.profileId, profile.id))).get();
      if (!row) return fail('credential-vault-unavailable');
      return vault.decrypt(scopeOf(profile), { version: row.version as 1, ciphertext: row.ciphertext, nonce: row.nonce, authTag: row.authTag });
    },
    fingerprint(profile) {
      return createHash('sha256').update(JSON.stringify({ id: profile.id, revision: profile.revision, name: profile.name, presetId: profile.presetId, config: profile.config, credentialMode: profile.credentialMode, credentialVersion: profile.credentialVersion, legacyCredential: profile.credentialMode === 'legacy-env' ? options.legacyKey() ?? null : null })).digest('hex');
    },
    recordCheck(id, expectedRevision, check) {
      return db.raw.transaction(() => {
        const registry = current(), old = registry.profiles.find(p => p.id === id); if (!old) return fail('profile-not-found');
        if (old.revision !== expectedRevision || check.revision !== expectedRevision || check.fingerprint !== service.fingerprint(old)) return fail('profile-stale-check');
        const updated = { ...old, check: { ...check } }, profiles = registry.profiles.map(p => p.id === id ? updated : p); store({ ...registry, profiles });
        if (getSetting(db, MIGRATION_PROFILE_KEY, '') === id) db.delete(settings).where(eq(settings.key, MIGRATION_PROFILE_KEY)).run();
        return clean(updated);
      })();
    },
    activate(id, expectedRevision) {
      db.raw.transaction(() => {
        const registry = current();
        if (id === null) { store({ ...registry, activeProfileId: null }); return; }
        const profile = registry.profiles.find(p => p.id === id); if (!profile) return fail('profile-not-found');
        if (expectedRevision !== profile.revision) return fail('profile-revision-conflict');
        if (!profile.check || profile.check.revision !== profile.revision || profile.check.status !== 'ready' || profile.check.fingerprint !== service.fingerprint(profile)) return fail('profile-not-ready');
        validateRuntimeProfile(profile);
        if (profile.credentialMode === 'stored') { if (!keyPresent(profile)) return fail('credential-vault-unavailable'); service.resolveCredential({ ...createEvaluatorSnapshot(profile.config), connection: service.snapshot(profile) }); }
        if (profile.credentialMode === 'legacy-env' && !options.legacyKey()) return fail('provider-credentials');
        store({ ...registry, activeProfileId: id });
      })();
    },
    activeReady() {
      const registry = current(); if (!registry.activeProfileId) return null;
      const profile = find(registry.activeProfileId);
      if (!profile.check || profile.check.status !== 'ready' || profile.check.revision !== profile.revision || profile.check.fingerprint !== service.fingerprint(profile)) return fail('profile-not-ready');
      validateRuntimeProfile(profile);
      if (profile.credentialMode === 'stored') service.resolveCredential({ ...createEvaluatorSnapshot(profile.config), connection: service.snapshot(profile) });
      if (profile.credentialMode === 'legacy-env' && !options.legacyKey()) return fail('provider-credentials');
      return profile;
    },
    snapshot(profile) { return { profileId: profile.id, profileName: profile.name, presetId: profile.presetId, profileRevision: profile.revision, credentialMode: profile.credentialMode, credentialVersion: profile.credentialVersion }; },
  };
  return service;
}
