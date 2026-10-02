import { AiProviderError, type ModelCatalog, type ModelCatalogEntry, type ProviderProfile } from '@shotprompt/core';
import type { ProfileService } from './provider-profiles';

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_MODELS = 3000;
const MAX_PAGES = 10;
const TTL = 5 * 60 * 1000;
type CatalogResponse = { entries: ModelCatalogEntry[]; truncated: boolean };
const safeError = (code = 'provider-catalog-unavailable') => new AiProviderError(code);

function finitePositive(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
function supportsText(row: any): boolean | null {
  const modality = row?.architecture?.modality;
  if (typeof modality === 'string') {
    const [input, output] = modality.split('->');
    return typeof input === 'string' && typeof output === 'string' ? /text/.test(input) && /text/.test(output) : null;
  }
  const input = row?.architecture?.input_modalities ?? row?.input_modalities;
  const output = row?.architecture?.output_modalities ?? row?.output_modalities;
  if (Array.isArray(input) && Array.isArray(output)) return input.includes('text') && output.includes('text');
  if (Array.isArray(output) && !output.includes('text')) return false;
  if (Array.isArray(input) && !input.includes('text')) return false;
  return null;
}
function supportsSchema(row: any): boolean | null {
  const params = row?.supported_parameters ?? row?.supportedParameters;
  if (!Array.isArray(params)) return null;
  return params.some((param: unknown) => typeof param === 'string' && ['response_format', 'structured_outputs', 'json_schema'].includes(param));
}
function entryFrom(row: any): ModelCatalogEntry | null {
  if (!row || typeof row !== 'object') return null;
  const rawId = typeof row.id === 'string' ? row.id : typeof row.name === 'string' ? row.name : '';
  if (!rawId.trim() || rawId.length > 300) return null;
  const inputUsdPerMillion = finitePositive(row.pricing?.prompt ?? row.input_price ?? row.inputUsdPerMillion);
  const outputUsdPerMillion = finitePositive(row.pricing?.completion ?? row.output_price ?? row.outputUsdPerMillion);
  const context = finitePositive(row.context_length ?? row.contextLength);
  const text = supportsText(row);
  if (text === false) return null;
  const schema = supportsSchema(row);
  return {
    id: rawId.trim(), name: typeof row.name === 'string' && row.name.trim() ? row.name.trim().slice(0, 300) : rawId.trim(),
    contextLength: context !== null && Number.isSafeInteger(context) ? context : null,
    inputUsdPerMillion: inputUsdPerMillion === null ? null : inputUsdPerMillion * 1_000_000,
    outputUsdPerMillion: outputUsdPerMillion === null ? null : outputUsdPerMillion * 1_000_000,
    textCapability: text === true ? 'supported' : 'unknown',
    schemaSupport: schema === true ? 'supported' : schema === false ? 'unsupported' : 'unknown',
  };
}
export function normalizeModelCatalog(presetId: ProviderProfile['presetId'], value: unknown): ModelCatalogEntry[] {
  if (!value || typeof value !== 'object') return [];
  const list = presetId === 'ollama' ? (value as any).models : (value as any).data ?? (value as any).models;
  if (!Array.isArray(list)) return [];
  return list.map(entryFrom).filter((row: ModelCatalogEntry | null): row is ModelCatalogEntry => row !== null);
}
function endpoint(profile: ProviderProfile): string {
  const root = profile.config.baseUrl.replace(/\/$/, '');
  return profile.config.protocol === 'ollama' ? `${root}/api/tags` : `${root}/models`;
}
async function boundedJson(response: Response, signal: AbortSignal): Promise<any> {
  if (!response.ok || !response.body) throw safeError();
  const reader = response.body.getReader(); let bytes = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      signal.throwIfAborted(); const part = await reader.read(); signal.throwIfAborted();
      if (part.done) break;
      bytes += part.value.byteLength; if (bytes > MAX_BYTES) { await reader.cancel(); throw safeError('provider-catalog-too-large'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw safeError(); }
}
export interface ModelCatalogService { load(id: string, expectedRevision: number, refresh?: boolean): Promise<ModelCatalog>; clear(id: string): void }
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export function createModelCatalogService(profiles: ProfileService, dependencies: { fetch?: FetchLike; now?: () => number } = {}): ModelCatalogService {
  const fetcher: FetchLike = dependencies.fetch ?? fetch, now = dependencies.now ?? Date.now;
  const cache = new Map<string, { value: ModelCatalog; fingerprint: string }>();
  const inflight = new Map<string, Promise<ModelCatalog>>();
  return {
    clear(id) { for (const key of cache.keys()) if (key.startsWith(`${id}:`)) cache.delete(key); },
    async load(id, expectedRevision, refresh = false) {
      const profile = profiles.get(id);
      if (profile.revision !== expectedRevision) throw safeError('profile-stale-check');
      const fingerprint = profiles.fingerprint(profile), key = `${id}:${expectedRevision}:${fingerprint}`, cached = cache.get(key);
      if (!refresh && cached && now() - cached.value.fetchedAt < TTL) return { ...cached.value, entries: [...cached.value.entries] };
      const pending = inflight.get(key); if (pending) return pending;
      const request = (async (): Promise<ModelCatalog> => {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
        try {
          const snapshot = { provider: profile.config, connection: profiles.snapshot(profile) };
          const credential = profiles.resolveCredential(snapshot as any);
          let url: string | null = endpoint(profile);
          const entries: ModelCatalogEntry[] = [], seen = new Set<string>(); let truncated = false;
          for (let page = 0; page < MAX_PAGES && url; page++) {
            const requestedUrl: string = url;
            const response = await fetcher(requestedUrl, { headers: { accept: 'application/json', ...(credential ? { authorization: `Bearer ${credential}` } : {}) }, redirect: 'error', signal: controller.signal });
            if (response.status === 401 || response.status === 403) throw safeError('provider-credentials');
            if (response.status === 402) throw safeError('provider-credits');
            if (response.status === 429) throw safeError('provider-rate-limit');
            const value = await boundedJson(response, controller.signal);
            const normalized = normalizeModelCatalog(profile.presetId, value);
            for (const row of normalized) if (!seen.has(row.id) && !(credential && (row.id.includes(credential) || row.name.includes(credential)))) {
              if (entries.length === MAX_MODELS) { truncated = true; break; }
              seen.add(row.id); entries.push(row);
            }
            if (truncated) break;
            const next = value?.next;
            if (typeof next !== 'string' || !next) break;
            const nextUrl: URL = new URL(next, requestedUrl);
            const base = new URL(requestedUrl);
            if (nextUrl.origin !== base.origin || nextUrl.username || nextUrl.password) throw safeError();
            if (page === MAX_PAGES - 1) { truncated = true; break; }
            url = nextUrl.href;
          }
          const value: ModelCatalog = { entries, fetchedAt: now(), truncated, stale: false };
          if (profiles.get(id).revision !== expectedRevision || profiles.fingerprint(profiles.get(id)) !== fingerprint) throw safeError('profile-stale-check');
          cache.set(key, { value, fingerprint }); return value;
        } catch (error) {
          if (controller.signal.aborted) throw safeError('provider-catalog-timeout');
          if (error instanceof AiProviderError) {
            if (error.code === 'profile-stale-check') throw error;
            if (cached) return { ...cached.value, entries: [...cached.value.entries], stale: true, errorCode: error.code };
          }
          if (cached) return { ...cached.value, entries: [...cached.value.entries], stale: true, errorCode: 'provider-catalog-unavailable' };
          throw safeError(error instanceof AiProviderError ? error.code : undefined);
        } finally { clearTimeout(timer); }
      })();
      inflight.set(key, request);
      try { return await request; } finally { inflight.delete(key); }
    },
  };
}
