import { parseAnalysisOptions } from './analysis-profiles';
import type { AiAnalysisOptions, AnalysisAssessment, AiAssessment, RulesAnalysisOptions, StoredAnalysisOptions } from './ai-analysis-types';
export const DEFAULT_AI_ANALYSIS_OPTIONS: AiAnalysisOptions = { schemaVersion: 2, minDuration: 15, maxDuration: 60, instruction: '', maxClips: 10 };
export function parseAiAnalysisOptions(value: unknown): AiAnalysisOptions {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error('invalid analysis options');
  const o = { ...DEFAULT_AI_ANALYSIS_OPTIONS, ...(value as Partial<AiAnalysisOptions> | undefined) };
  if (o.schemaVersion !== 2 || !Number.isFinite(o.minDuration) || !Number.isFinite(o.maxDuration) || o.minDuration < 5 || o.maxDuration > 180 || o.minDuration > o.maxDuration || typeof o.instruction !== 'string' || [...o.instruction.trim()].length > 500 || !Number.isInteger(o.maxClips) || o.maxClips < 1 || o.maxClips > 30) throw new Error('invalid analysis options');
  return { schemaVersion: 2, minDuration: o.minDuration, maxDuration: o.maxDuration, instruction: o.instruction.trim(), maxClips: o.maxClips };
}
export function parseStoredAnalysisOptions(value: unknown): StoredAnalysisOptions {
  const version = value && typeof value === 'object' ? (value as { schemaVersion?: unknown }).schemaVersion : undefined;
  if (version === 2) return parseAiAnalysisOptions(value);
  if (version !== undefined && version !== 1) throw new Error('invalid analysis options');
  return parseAnalysisOptions(value);
}
export function legacyOptionsToAi(value: RulesAnalysisOptions): AiAnalysisOptions { return parseAiAnalysisOptions({ minDuration: value.minDuration, maxDuration: value.maxDuration, instruction: value.query }); }
export function isAiAssessment(value: AnalysisAssessment): value is AiAssessment { return value.schemaVersion === 2; }
