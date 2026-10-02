import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type { DB } from '@shotprompt/db';
import { DEFAULT_AI_BUDGETS, type EvaluatorSnapshot, type ProviderConfig } from '@shotprompt/core';
import { getSetting, setSetting } from '../env';
export const PROVIDER_DEFAULTS: ProviderConfig = { protocol: 'ollama', inferenceLocation: 'local', baseUrl: 'http://127.0.0.1:11434', model: '', outputMode: 'schema', externalEnabled: false, requestTimeoutSeconds: 120, runTimeoutSeconds: 1800 };
function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1') return true;
  if (isIP(host) === 6) return /^(fc|fd|fe[89ab])/.test(host);
  if (isIP(host) !== 4) return false;
  const [a, b] = host.split('.').map(Number);
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}
export function parseProviderConfig(value: unknown): ProviderConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid provider configuration');
  const o = { ...PROVIDER_DEFAULTS, ...value as Partial<ProviderConfig> };
  const bad = () => { throw new Error('invalid provider configuration'); };
  if (!['ollama', 'openai-compatible'].includes(o.protocol) || !['local', 'external'].includes(o.inferenceLocation) || !['schema', 'json'].includes(o.outputMode) || typeof o.externalEnabled !== 'boolean' || typeof o.model !== 'string' || !o.model.trim() || [...o.model].length > 200 || typeof o.baseUrl !== 'string' || o.baseUrl.length > 2000) return bad();
  let url: URL; try { url = new URL(o.baseUrl); } catch { return bad(); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (o.inferenceLocation === 'local' && !isPrivateHost(url.hostname)) || (o.inferenceLocation === 'external' && !o.externalEnabled)) return bad();
  if (!Number.isInteger(o.requestTimeoutSeconds) || o.requestTimeoutSeconds < 10 || o.requestTimeoutSeconds > 600 || !Number.isInteger(o.runTimeoutSeconds) || o.runTimeoutSeconds < 60 || o.runTimeoutSeconds > 7200 || o.runTimeoutSeconds < o.requestTimeoutSeconds) return bad();
  const presetId = ['openrouter', 'gemini', 'ollama', 'local-compatible', 'custom'].includes(String((value as Partial<ProviderConfig>).presetId)) ? (value as ProviderConfig).presetId : undefined;
  return { ...(presetId ? { presetId } : {}), protocol: o.protocol, inferenceLocation: o.inferenceLocation, baseUrl: url.href.replace(/\/$/, ''), model: o.model.trim(), outputMode: o.outputMode, externalEnabled: o.externalEnabled, requestTimeoutSeconds: o.requestTimeoutSeconds, runTimeoutSeconds: o.runTimeoutSeconds };
}
export function readProviderConfig(db: DB): ProviderConfig | null {
  const value = getSetting(db, 'analysisProvider', '');
  if (!value) return null;
  try { return parseProviderConfig(JSON.parse(value)); } catch { return null; }
}
export function saveProviderConfig(db: DB, config: ProviderConfig): void { setSetting(db, 'analysisProvider', JSON.stringify(parseProviderConfig(config))); }
export function providerFingerprint(config: ProviderConfig): string { return createHash('sha256').update(JSON.stringify(config)).digest('hex'); }
export function createEvaluatorSnapshot(config: ProviderConfig, triggerPipelineJobId?: string): EvaluatorSnapshot {
  return { provider: { ...parseProviderConfig(config) }, engineVersion: 'llm-v1', promptVersion: 'highlight-prompts-v1', rubricVersion: 'clip-content-v1', budgets: { ...DEFAULT_AI_BUDGETS }, ...(triggerPipelineJobId ? { triggerPipelineJobId } : {}) };
}
export interface ProviderCheck { fingerprint: string; status: 'ready' | 'failed'; checkedAt: number; errorCode: string | null }
export function readProviderCheck(db: DB, config: ProviderConfig | null): ProviderCheck | null {
  if (!config) return null;
  try { const check = JSON.parse(getSetting(db, 'analysisProviderCheck', 'null')) as ProviderCheck | null; return check?.fingerprint === providerFingerprint(config) ? check : null; } catch { return null; }
}
