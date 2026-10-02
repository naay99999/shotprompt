import type { ProviderConfig } from './ai-analysis-types';
export const PROVIDER_PRESET_IDS = ['openrouter', 'gemini', 'ollama', 'local-compatible', 'custom'] as const;
export type ProviderPresetId = typeof PROVIDER_PRESET_IDS[number];
export interface CredentialScope { profileId: string; credentialVersion: string; protocol: ProviderConfig['protocol']; baseUrl: string }
export type CredentialMode = 'none' | 'stored' | 'legacy-env';
export type CredentialOperation = { action: 'keep' } | { action: 'remove' } | { action: 'replace'; key: string };
export interface ProviderPreset { id: ProviderPresetId; name: string; protocol: ProviderConfig['protocol']; inferenceLocation: ProviderConfig['inferenceLocation']; baseUrl: string; credentialRequired: boolean; documentationUrl: string; apiKeyUrl: string | null }
export interface ProfileDraft { name: string; presetId: ProviderPresetId; config: ProviderConfig }
export interface ProfileWrite { expectedRevision?: number; draft: ProfileDraft; credential: CredentialOperation }
export interface ProfileCheck { fingerprint: string; revision: number; status: 'ready' | 'failed'; checkedAt: number; errorCode: string | null }
export interface ProviderProfile extends ProfileDraft { id: string; revision: number; credentialMode: CredentialMode; credentialVersion: string | null; createdAt: number; updatedAt: number; check: ProfileCheck | null }
export interface ProfileView extends Omit<ProviderProfile, 'credentialVersion'> { keyPresent: boolean; vaultAvailable: boolean }
export interface ProviderRegistry { schemaVersion: 1; activeProfileId: string | null; profiles: ProviderProfile[] }
export interface ConnectionSnapshot { profileId: string; profileName: string; presetId: ProviderPresetId; profileRevision: number; credentialMode: CredentialMode; credentialVersion: string | null }
export interface ModelCatalogEntry { id: string; name: string; contextLength: number | null; inputUsdPerMillion: number | null; outputUsdPerMillion: number | null; textCapability: 'supported' | 'unknown'; schemaSupport: 'supported' | 'unsupported' | 'unknown' }
export interface ModelCatalog { entries: ModelCatalogEntry[]; fetchedAt: number; truncated: boolean; stale: boolean; errorCode?: string }
export class AiProviderError extends Error { constructor(public code: string, message = code) { super(message); this.name = 'AiProviderError'; } }
