import { AiAnalysisError, DEFAULT_AI_ANALYSIS_OPTIONS, parseEvaluationResponse, type AiAnalysisInput, type EvaluationBatch, type ProviderConfig } from '@shotprompt/core';
import type { ProfileCheck, ProviderProfile } from '@shotprompt/core';
import type { ProfileService } from './provider-profiles';
import { EVALUATION_SCHEMA } from './prompts';
import { createProviderClient, type ProviderClient } from './provider-client';
import { createEvaluatorSnapshot, parseProviderConfig } from './provider-settings';

const sample = [
  { id: 1, start: 0, end: 20, text: '[synthetic segment 1] ผู้พูดอธิบายประเด็นหนึ่งอย่างชัดเจน' },
  { id: 2, start: 20, end: 40, text: '[synthetic segment 2] ผู้พูดสรุปประเด็นให้จบครบถ้วน' },
];
const proposal = { proposalId: 'probe-1', startSegmentId: 1, endSegmentId: 2, provisionalTitle: 'Synthetic sample', evidenceSegmentIds: [1, 2] };
function probeInput(): AiAnalysisInput { return { duration: 40, language: 'th', segments: sample, scenes: [], options: { ...DEFAULT_AI_ANALYSIS_OPTIONS, minDuration: 5, maxDuration: 40, maxClips: 1, instruction: 'Evaluate only the synthetic sample and return one grounded result.' } }; }
export async function checkScoringProvider(_config: ProviderConfig, client: ProviderClient, signal: AbortSignal): Promise<{ status: 'ready' }> {
  const input = probeInput(), batch: EvaluationBatch = { proposals: [proposal], segments: sample };
  const request = { messages: [
    { role: 'system' as const, content: `Return one accepted result for the supplied synthetic scoring sample. Include all five 0–5 dimensions and evidence IDs from the sample. Do not add content. Return this exact JSON shape: ${JSON.stringify(EVALUATION_SCHEMA)}` },
    { role: 'user' as const, content: JSON.stringify({ instruction: input.options.instruction, segments: sample, proposal }) },
  ], schema: EVALUATION_SCHEMA, maxOutputTokens: 1024 };
  signal.throwIfAborted();
  const response = await client.complete(request, signal);
  signal.throwIfAborted();
  const rows = parseEvaluationResponse(response.value, batch, input, input.options);
  if (rows.length !== 1 || 'rejected' in rows[0]) throw new AiAnalysisError('invalid-output');
  return { status: 'ready' };
}
export async function checkSavedProfile(profiles: ProfileService, id: string, expectedRevision: number, options: { clientFactory?: (config: ProviderConfig, apiKey: () => string | undefined) => ProviderClient; now?: () => number } = {}): Promise<import('@shotprompt/core').ProfileView> {
  const profile: ProviderProfile = profiles.get(id);
  if (profile.revision !== expectedRevision) throw new AiAnalysisError('profile-revision-conflict');
  const config = parseProviderConfig(profile.config);
  const fingerprint = profiles.fingerprint(profile), snapshot = { ...createEvaluatorSnapshot(config), connection: profiles.snapshot(profile) };
  let errorCode: string | null = null;
  try {
    const client = (options.clientFactory ?? ((value, apiKey) => createProviderClient(value, { apiKey })))(config, () => profiles.resolveCredential(snapshot));
    await checkScoringProvider(config, client, new AbortController().signal);
  } catch (error) { errorCode = error instanceof AiAnalysisError ? error.code : error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'provider-unavailable'; }
  const check: ProfileCheck = { fingerprint, revision: profile.revision, status: errorCode ? 'failed' : 'ready', checkedAt: (options.now ?? Date.now)(), errorCode };
  return profiles.recordCheck(id, expectedRevision, check);
}
