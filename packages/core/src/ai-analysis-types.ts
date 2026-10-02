import type { AnalysisInput, AnalysisOptions, Assessment, Evidence, HighlightResult } from './analysis-types';
export type RulesAnalysisOptions = AnalysisOptions;
export type RulesAssessment = Assessment;
export interface AiAnalysisOptions { schemaVersion: 2; minDuration: number; maxDuration: number; instruction: string; maxClips: number }
export type StoredAnalysisOptions = RulesAnalysisOptions | AiAnalysisOptions;
export type AnalysisSource = Omit<AnalysisInput, 'options'>;
export type AiAnalysisInput = AnalysisSource & { options: AiAnalysisOptions };
export type AiDimension = 'opening' | 'standalone' | 'substance' | 'closure' | 'relevance';
export interface AiAssessment {
  schemaVersion: 2; engine: 'llm-v1'; title: string; summary: string; tags: string[];
  dimensions: Record<AiDimension, { value: number | null; evidence: Evidence[] }>;
  reasons: { text: string; evidence: Evidence[] }[]; warnings: string[];
  suppressedBy: string | null; suppressionReason: 'overlap' | 'text' | 'semantic' | 'overflow' | null;
}
export type AnalysisAssessment = RulesAssessment | AiAssessment;
export type AnyHighlightResult = Omit<HighlightResult, 'assessment'> & { assessment: AnalysisAssessment };
export interface ProviderConfig {
  protocol: 'ollama' | 'openai-compatible'; inferenceLocation: 'local' | 'external'; baseUrl: string; model: string;
  outputMode: 'schema' | 'json'; externalEnabled: boolean; presetId?: import('./ai-provider-types').ProviderPresetId; requestTimeoutSeconds: number; runTimeoutSeconds: number;
}
export interface AiBudgets { coreCodepoints: number; contextCodepoints: number; maxChunks: number; maxProposals: number; maxRequests: number; evaluationBatchSize: number; evaluationCodepoints: number }
export const DEFAULT_AI_BUDGETS: AiBudgets = { coreCodepoints: 8000, contextCodepoints: 2000, maxChunks: 40, maxProposals: 120, maxRequests: 160, evaluationBatchSize: 4, evaluationCodepoints: 16000 };
export interface EvaluatorSnapshot { provider: ProviderConfig; connection?: import('./ai-provider-types').ConnectionSnapshot; engineVersion: 'llm-v1'; promptVersion: 'highlight-prompts-v1'; rubricVersion: 'clip-content-v1'; budgets: AiBudgets; triggerPipelineJobId?: string }
export interface EvaluatorMetadata { snapshot: EvaluatorSnapshot; reportedModels: string[]; usage: { inputTokens: number | null; outputTokens: number | null }; requestCount: number; elapsedMs: number }
export interface AnalysisProgress { stage: 'discovery' | 'evaluation' | 'thumbnails'; completed: number; total: number; requestCount: number; elapsedMs: number }
export interface EvaluationContext { signal: AbortSignal; snapshot: EvaluatorSnapshot | null; onProgress(progress: AnalysisProgress): void }
export interface EvaluationOutput { results: AnyHighlightResult[]; metadata: EvaluatorMetadata | null }
export interface AiChunk { id: string; coreSegmentIds: number[]; segments: AnalysisInput['segments']; coreStart: number; coreEnd: number }
export interface AiProposal { proposalId: string; startSegmentId: number; endSegmentId: number; provisionalTitle: string; evidenceSegmentIds: number[] }
export interface DiscoveryResponse { status: 'analyzed' | 'unsupported-language' | 'insufficient-transcript'; proposals: AiProposal[]; requestedBoundaryContext: ('before' | 'after')[] }
export interface EvaluationBatch { proposals: AiProposal[]; segments: AnalysisInput['segments'] }
export interface DuplicateLink { proposalId: string; duplicateOf: string; evidenceSegmentIds: number[] }
export interface AcceptedAiEvaluation {
  proposalId: string; startSegmentId: number; endSegmentId: number; title: string; summary: string; tags: string[];
  dimensions: Record<AiDimension, { value: number; evidenceSegmentIds: number[] }>;
  reasons: { text: string; evidenceSegmentIds: number[] }[]; warnings: string[];
  duplicateOf?: string; duplicateEvidenceSegmentIds?: number[];
}
export interface RejectedAiEvaluation { proposalId: string; rejected: true; reason: string; evidenceSegmentIds: number[] }
export type AiEvaluation = AcceptedAiEvaluation | RejectedAiEvaluation;
export class AiAnalysisError extends Error { constructor(public code: string, message = code) { super(message); this.name = 'AiAnalysisError'; } }
