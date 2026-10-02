import type { StoredAnalysisOptions, AnalysisAssessment, EvaluatorMetadata, AnalysisProgress } from './ai-analysis-types';
export type Category = 'sales' | 'podcast' | 'education' | 'story';
export type Goal = 'balanced' | 'sell' | 'teach' | 'entertain' | 'drive-full-video';
export interface AnalysisOptions { categories: Category[]; goal: Goal; minDuration: number; maxDuration: number; query: string }
export interface AnalysisSegment { id: number; start: number; end: number; text: string }
export interface AnalysisInput { segments: AnalysisSegment[]; scenes: number[]; duration: number; language: string; options: AnalysisOptions }
export interface HighlightWindow { key: string; start: number; end: number; segmentIds: number[]; source: 'speech' | 'scene'; warnings: string[] }
export interface Evidence { code: string; segmentId: number; start: number; end: number; text: string }
export interface Dimensions { hook: number | null; categoryFit: number | null; completeness: number | null; pacing: number | null; goalFit: number | null }
export interface Assessment {
  schemaVersion: 1; engine: 'rules-v1'; primaryCategory: Category | null;
  categoryScores: Partial<Record<Category, { score: number; dimensions: Dimensions; evidence: Evidence[] }>>;
  dimensions: Dimensions; reasons: Evidence[]; warnings: string[];
  evidenceLevel: 'limited' | 'moderate' | 'strong'; suppressedBy: string | null; suppressionReason: 'overlap' | 'text' | null;
}
export type HighlightResult = HighlightWindow & { score: number | null; assessment: Assessment; rank: number; isPrimary: boolean };
export type ScoredHighlight = Omit<HighlightResult, 'rank' | 'isPrimary'>;
export type FeedbackVerdict = 'good' | 'irrelevant' | 'starts-mid-thought' | 'ends-too-soon' | 'duplicate';
export interface AnalysisRunView { id: string; videoId: string; jobId: string; status: 'queued' | 'running' | 'done' | 'failed' | 'canceled'; options: StoredAnalysisOptions; evaluatorMetadata?: EvaluatorMetadata | null; progress?: AnalysisProgress | null; engineVersion: string; sourceRevision: string; createdAt: number; completedAt: number | null; error: string | null }
export interface CandidateView { id: string; videoId: string; runId: string | null; start: number; end: number; score: number | null; thumbnailPath: string | null; assessment: AnalysisAssessment | null; feedback: FeedbackVerdict | null; rank: number | null; isPrimary: boolean }
export interface ClipAssessmentSnapshot { assessment: AnalysisAssessment; options: StoredAnalysisOptions; evaluatorMetadata?: EvaluatorMetadata | null; runId: string; sourceRevision: string; evaluatedStart: number; evaluatedEnd: number; feedback: FeedbackVerdict | null }
