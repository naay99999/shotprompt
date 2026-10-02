import { expect, it } from 'bun:test';
import { initialAnalysisState, reduceAnalysisState } from '../lib/analysis-state';
import type { AnalysisRunView } from '@shotprompt/core';
it('refresh preserves dirty options and ignores stale requests and previous video responses', () => {
  let state = initialAnalysisState('v1');
  state = reduceAnalysisState(state, { type: 'edit-options', options: { ...state.draftOptions, instruction: 'มือใหม่' } });
  state = reduceAnalysisState(state, { type: 'load-start', videoId: 'v1', requestId: 2 });
  const runs = { active: null, latest: null, history: [] };
  state = reduceAnalysisState(state, { type: 'load-success', videoId: 'v1', requestId: 2, runs, candidates: [] });
  expect(state.draftOptions.instruction).toBe('มือใหม่'); expect(state.draftDirty).toBe(true);
  expect(reduceAnalysisState(state, { type: 'load-error', videoId: 'v1', requestId: 1, error: 'old' })).toBe(state);
  state = reduceAnalysisState(state, { type: 'change-video', videoId: 'v2' });
  expect(state.draftOptions.instruction).toBe('');
  expect(reduceAnalysisState(state, { type: 'load-success', videoId: 'v1', requestId: 2, runs, candidates: [] })).toBe(state);
});
it('history selection does not overwrite draft options', () => {
  let state = initialAnalysisState('v');
  state = reduceAnalysisState(state, { type: 'edit-options', options: { ...state.draftOptions, instruction: 'work' } });
  state = reduceAnalysisState(state, { type: 'select-run', runId: 'old-run' });
  expect(state.draftOptions.instruction).toBe('work');
  state = reduceAnalysisState(state, { type: 'restore-options', options: { ...state.draftOptions, instruction: 'restored' } });
  expect(state.draftOptions.instruction).toBe('restored');
});
it('adopts saved options on first response but later failures preserve candidates', () => {
  let state = initialAnalysisState('v'); state = reduceAnalysisState(state, { type: 'load-start', videoId: 'v', requestId: 1 });
  const run = { options: { ...state.draftOptions, instruction: 'saved' } } as AnalysisRunView;
  state = reduceAnalysisState(state, { type: 'load-success', videoId: 'v', requestId: 1, runs: { active: run, latest: run, history: [run] }, candidates: [] });
  expect(state.draftOptions.instruction).toBe('saved');
  const before = state.candidates; state = reduceAnalysisState(state, { type: 'load-error', videoId: 'v', requestId: 1, error: 'failed' });
  expect(state.candidates).toBe(before);
});
it('adopts upload choices when the first analysis appears after initially empty history', () => {
  let state = initialAnalysisState('v');
  state = reduceAnalysisState(state, { type: 'load-start', videoId: 'v', requestId: 1 });
  state = reduceAnalysisState(state, { type: 'load-success', videoId: 'v', requestId: 1, runs: { active: null, latest: null, history: [] }, candidates: [] });
  const run = { options: { ...state.draftOptions, maxClips: 3, instruction: 'saved' } } as AnalysisRunView;
  state = reduceAnalysisState(state, { type: 'load-start', videoId: 'v', requestId: 2 });
  state = reduceAnalysisState(state, { type: 'load-success', videoId: 'v', requestId: 2, runs: { active: run, latest: run, history: [run] }, candidates: [] });
  expect(state.draftOptions.instruction).toBe('saved'); expect(state.draftOptions.maxClips).toBe(3);
});
