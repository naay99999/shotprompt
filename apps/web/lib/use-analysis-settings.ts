'use client';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { api } from './api';
import { checkResponse } from './ui-error';
import { initialProviderState, reduceProviderState } from './analysis-settings-state';
import type { ProviderConfig } from '@shotprompt/core';
export function useAnalysisSettings() {
  const [state, dispatch] = useReducer(reduceProviderState, initialProviderState), [saving, setSaving] = useState(false);
  const serial = useRef(0), busy = useRef(false);
  const refresh = useCallback(async () => {
    const requestId = ++serial.current; dispatch({ type: 'load-start', requestId });
    try { const response = checkResponse(await api.settings.analysis.get()); if (response.data) dispatch({ type: 'load-success', requestId, data: response.data }); }
    catch (error) { dispatch({ type: 'load-error', requestId, error }); }
  }, []);
  useEffect(() => { void refresh(); return () => { serial.current++; }; }, [refresh]);
  async function perform(check: boolean) {
    if (!state.config || busy.current) return;
    busy.current = true; setSaving(true); const requestId = ++serial.current; dispatch({ type: 'load-start', requestId });
    try {
      checkResponse(await api.settings.analysis.put(state.config));
      if (check) checkResponse(await api.settings.analysis.check.post());
      const response = checkResponse(await api.settings.analysis.get());
      if (response.data) dispatch({ type: 'load-success', requestId, data: response.data, saved: true });
    } catch (error) { dispatch({ type: 'load-error', requestId, error }); }
    finally { busy.current = false; setSaving(false); }
  }
  return { ...state, saving, refresh, save: () => perform(false), checkConnection: () => perform(true), setConfig: (config: ProviderConfig) => dispatch({ type: 'edit', config }) };
}
