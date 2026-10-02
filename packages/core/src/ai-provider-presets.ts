import { AiProviderError, PROVIDER_PRESET_IDS, type CredentialOperation, type ProfileDraft, type ProfileWrite, type ProviderPreset, type ProviderPresetId, type ProfileView } from './ai-provider-types';
import type { ProviderConfig } from './ai-analysis-types';
const presets: ProviderPreset[] = [
  { id: 'openrouter', name: 'OpenRouter', protocol: 'openai-compatible', inferenceLocation: 'external', baseUrl: 'https://openrouter.ai/api/v1', credentialRequired: true, documentationUrl: 'https://openrouter.ai/docs/quickstart', apiKeyUrl: 'https://openrouter.ai/settings/keys' },
  { id: 'gemini', name: 'Gemini', protocol: 'openai-compatible', inferenceLocation: 'external', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', credentialRequired: true, documentationUrl: 'https://ai.google.dev/gemini-api/docs/openai', apiKeyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'ollama', name: 'Ollama', protocol: 'ollama', inferenceLocation: 'local', baseUrl: 'http://127.0.0.1:11434', credentialRequired: false, documentationUrl: 'https://docs.ollama.com/api', apiKeyUrl: null },
  { id: 'local-compatible', name: 'Local OpenAI-compatible', protocol: 'openai-compatible', inferenceLocation: 'local', baseUrl: 'http://127.0.0.1:1234/v1', credentialRequired: false, documentationUrl: '', apiKeyUrl: null },
  { id: 'custom', name: 'Custom API', protocol: 'openai-compatible', inferenceLocation: 'local', baseUrl: 'http://127.0.0.1:1234/v1', credentialRequired: false, documentationUrl: '', apiKeyUrl: null },
];
const invalid = (): never => { throw new AiProviderError('invalid-provider-profile'); };
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function getProviderPresets(): ProviderPreset[] { return presets.map(preset => ({ ...preset })); }
export function createProfileDraft(presetId: ProviderPresetId): ProfileDraft {
  const preset = presets.find(candidate => candidate.id === presetId); if (!preset) return invalid();
  return { name: preset.name, presetId, config: { presetId, protocol: preset.protocol, inferenceLocation: preset.inferenceLocation, baseUrl: preset.baseUrl, model: '', outputMode: 'schema', externalEnabled: false, requestTimeoutSeconds: 120, runTimeoutSeconds: 1800 } };
}
function parseDraft(value: unknown): ProfileDraft {
  if (!isRecord(value) || typeof value.name !== 'string' || !value.name.trim() || [...value.name.trim()].length > 80 || !PROVIDER_PRESET_IDS.includes(value.presetId as ProviderPresetId) || !isRecord(value.config)) return invalid();
  const p = presets.find(row => row.id === value.presetId)!; const c = value.config;
  if (!['ollama', 'openai-compatible'].includes(String(c.protocol)) || !['local', 'external'].includes(String(c.inferenceLocation)) || !['schema', 'json'].includes(String(c.outputMode)) || typeof c.externalEnabled !== 'boolean' || typeof c.model !== 'string' || [...c.model].length > 200 || typeof c.baseUrl !== 'string' || c.baseUrl.length > 2000 || !Number.isInteger(c.requestTimeoutSeconds) || (c.requestTimeoutSeconds as number) < 10 || (c.requestTimeoutSeconds as number) > 600 || !Number.isInteger(c.runTimeoutSeconds) || (c.runTimeoutSeconds as number) < 60 || (c.runTimeoutSeconds as number) > 7200 || (c.runTimeoutSeconds as number) < (c.requestTimeoutSeconds as number)) return invalid();
  let url: URL; try { url = new URL(c.baseUrl); } catch { return invalid(); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return invalid();
  if (value.presetId !== 'custom' && (p.baseUrl !== url.href.replace(/\/$/, '') || p.protocol !== c.protocol || p.inferenceLocation !== c.inferenceLocation)) return invalid();
  if (c.inferenceLocation === 'local' && !isPrivateHost(url.hostname)) return invalid();
  if (c.inferenceLocation === 'external' && url.protocol !== 'https:') return invalid();
  if (p.id === 'custom' && !['ollama', 'openai-compatible'].includes(String(c.protocol))) return invalid();
  const config: ProviderConfig = { presetId: value.presetId as ProviderPresetId, protocol: c.protocol as ProviderConfig['protocol'], inferenceLocation: c.inferenceLocation as ProviderConfig['inferenceLocation'], baseUrl: url.href.replace(/\/$/, ''), model: c.model.trim(), outputMode: c.outputMode as ProviderConfig['outputMode'], externalEnabled: c.externalEnabled, requestTimeoutSeconds: c.requestTimeoutSeconds as number, runTimeoutSeconds: c.runTimeoutSeconds as number };
  return { name: value.name.trim(), presetId: value.presetId as ProviderPresetId, config };
}
function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1') return true;
  if (host.includes(':') && /^(fc|fd|fe[89ab])/.test(host)) return true;
  const m = /^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = m.slice(1).map(Number);
  return [a, b, ...m.slice(3).map(Number)].every(n => n >= 0 && n <= 255) && (a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 169 && b === 254);
}
function parseCredential(value: unknown): CredentialOperation {
  if (!isRecord(value)) return invalid();
  if (value.action === 'keep' || value.action === 'remove') return { action: value.action };
  if (value.action !== 'replace' || typeof value.key !== 'string' || !value.key.trim() || /[\r\n]/.test(value.key) || new TextEncoder().encode(value.key).byteLength > 4096) return invalid();
  return { action: 'replace', key: value.key.trim() };
}
export function parseProfileWrite(value: unknown): ProfileWrite {
  if (!isRecord(value) || ('expectedRevision' in value && (!Number.isInteger(value.expectedRevision) || (value.expectedRevision as number) < 1))) return invalid();
  const draft = parseDraft(value.draft), credential = parseCredential(value.credential);
  return { ...(value.expectedRevision === undefined ? {} : { expectedRevision: value.expectedRevision as number }), draft, credential };
}
export function validateRuntimeProfile(profile: ProviderViewForValidation): ProviderConfig {
  const draft = parseDraft(profile);
  if (!draft.config.model || (draft.config.inferenceLocation === 'external' && !draft.config.externalEnabled) || (presets.find(p => p.id === draft.presetId)!.credentialRequired && !['stored', 'legacy-env'].includes(profile.credentialMode))) return invalid();
  return draft.config;
}
type ProviderViewForValidation = ProfileDraft & { credentialMode: import('./ai-provider-types').CredentialMode };
export function isProfileView(value: unknown): value is ProfileView { return isRecord(value) && typeof value.id === 'string' && typeof value.keyPresent === 'boolean'; }
