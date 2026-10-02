'use client';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { parseAiAnalysisOptions, legacyOptionsToAi, type AiAnalysisOptions, type StoredAnalysisOptions } from '@shotprompt/core';
import { api } from './api';
import { checkResponse } from './ui-error';
import { useEvents } from './use-events';
import { initialAnalysisState, reduceAnalysisState } from './analysis-state';
export function useAnalysis(videoId: string) {
  const [state, dispatch] = useReducer(reduceAnalysisState, videoId, initialAnalysisState);
  const [providerConfigured, setProviderConfigured] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false), [actionError, setActionError] = useState<unknown>(null);
  const serial = useRef(0), busy = useRef(false);
  const selectedRunId = state.videoId === videoId ? state.selectedRunId : null;
  const refresh = useCallback(async () => {
    const requestId = ++serial.current;
    dispatch({ type: 'load-start', videoId, requestId });
    try {
      const [runs, rows, profiles] = await Promise.all([api.videos({ id: videoId }).analysis.get(), api.videos({ id: videoId }).candidates.get({ query: { includeSuppressed: 'true', ...(selectedRunId ? { runId: selectedRunId } : {}) } }), api.analysis.profiles.get()]);
      checkResponse(runs); checkResponse(rows); checkResponse(profiles);
      if (profiles.data) { setProviderConfigured(profiles.data.configured); dispatch({ type: 'defaults', options: profiles.data.defaults }); }
      if (runs.data && rows.data) dispatch({ type: 'load-success', videoId, requestId, runs: runs.data, candidates: rows.data });
    } catch (error) { dispatch({ type: 'load-error', videoId, requestId, error }); }
  }, [videoId, selectedRunId]);
  useEffect(() => { dispatch({ type: 'change-video', videoId }); setActionError(null); }, [videoId]);
  useEffect(() => { void refresh(); return () => { serial.current++; }; }, [refresh]);
  useEvents(event => {
    if (event.type === '$reconnect' || (event.videoId === videoId && ['analysis:update', 'job:update', 'video:update'].includes(event.type))) void refresh();
  });
  async function reanalyze() {
    if (busy.current) return;
    busy.current = true; setSubmitting(true); setActionError(null);
    try {
      const options = parseAiAnalysisOptions(state.draftOptions);
      checkResponse(await api.videos({ id: videoId }).analysis.post(options));
      dispatch({ type: 'select-run', runId: null }); if (!selectedRunId) await refresh();
    } catch (error) { setActionError(error); } finally { busy.current = false; setSubmitting(false); }
  }
  async function cancel() {
    if (!state.latest || busy.current) return;
    busy.current = true; setSubmitting(true); setActionError(null);
    try { checkResponse(await api.jobs({ id: state.latest.jobId }).cancel.post()); await refresh(); }
    catch (error) { setActionError(error); } finally { busy.current = false; setSubmitting(false); }
  }
  return { ...state, providerConfigured, submitting, actionError, refresh, reanalyze, cancel,
    setDraftOptions: (options: AiAnalysisOptions) => dispatch({ type: 'edit-options', options }),
    selectRun: (runId: string | null) => dispatch({ type: 'select-run', runId }),
    restoreOptions: (options: StoredAnalysisOptions) => dispatch({ type: 'restore-options', options: 'instruction' in options ? options : legacyOptionsToAi(options) }),
  };
}
