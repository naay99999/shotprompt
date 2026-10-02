import { parseAiAnalysisOptions, type AiAnalysisOptions, type AnalysisRunView, type CandidateView } from '@shotprompt/core';
export type AnalysisRuns = { active: AnalysisRunView | null; latest: AnalysisRunView | null; history: AnalysisRunView[] };
export interface AnalysisState extends AnalysisRuns { videoId: string; requestId: number; draftOptions: AiAnalysisOptions; draftDirty: boolean; initialized: boolean; selectedRunId: string | null; candidates: CandidateView[]; loading: boolean; error: unknown }
export type AnalysisAction =
  | { type: 'edit-options' | 'restore-options'; options: AiAnalysisOptions }
  | { type: 'defaults'; options: AiAnalysisOptions }
  | { type: 'load-start'; videoId: string; requestId: number }
  | { type: 'load-success'; videoId: string; requestId: number; runs: AnalysisRuns; candidates: CandidateView[] }
  | { type: 'load-error'; videoId: string; requestId: number; error: unknown }
  | { type: 'select-run'; runId: string | null }
  | { type: 'change-video'; videoId: string };
export function initialAnalysisState(videoId: string): AnalysisState { return { videoId, requestId: 0, draftOptions: parseAiAnalysisOptions(undefined), draftDirty: false, initialized: false, selectedRunId: null, active: null, latest: null, history: [], candidates: [], loading: false, error: null }; }
export function reduceAnalysisState(state: AnalysisState, action: AnalysisAction): AnalysisState {
  if (action.type === 'change-video') return initialAnalysisState(action.videoId);
  if (action.type === 'edit-options' || action.type === 'restore-options') return { ...state, draftOptions: action.options, draftDirty: true };
  if (action.type === 'defaults') return state.draftDirty || state.initialized ? state : { ...state, draftOptions: action.options };
  if (action.type === 'select-run') return { ...state, selectedRunId: action.runId, requestId: state.requestId + 1, loading: true };
  if (!('videoId' in action) || action.videoId !== state.videoId) return state;
  if (action.type === 'load-start') return { ...state, requestId: action.requestId, loading: true, error: null };
  if (action.requestId !== state.requestId) return state;
  if (action.type === 'load-error') return { ...state, loading: false, error: action.error };
  const rawSaved = action.runs.latest?.options ?? action.runs.active?.options;
  const saved = rawSaved && 'schemaVersion' in rawSaved && rawSaved.schemaVersion === 2 ? rawSaved : null;
  return { ...state, ...action.runs, candidates: action.candidates, draftOptions: !state.initialized && !state.draftDirty && saved ? saved : state.draftOptions, initialized: state.initialized || !!saved, loading: false, error: null };
}
