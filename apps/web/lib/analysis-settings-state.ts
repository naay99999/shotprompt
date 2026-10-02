import type { ProviderConfig } from '@shotprompt/core';
export interface ProviderCheckView { fingerprint: string; status: 'ready' | 'failed'; checkedAt: number; errorCode: string | null }
export interface ProviderSettingsData { config: ProviderConfig | null; defaults: ProviderConfig; keyPresent: boolean; check: ProviderCheckView | null }
export interface ProviderState { config: ProviderConfig | null; keyPresent: boolean; check: ProviderCheckView | null; dirty: boolean; requestId: number; loading: boolean; error: unknown }
export const initialProviderState: ProviderState = { config: null, keyPresent: false, check: null, dirty: false, requestId: 0, loading: true, error: null };
type Action = { type: 'edit'; config: ProviderConfig } | { type: 'load-start'; requestId: number } | { type: 'load-success'; requestId: number; data: ProviderSettingsData; saved?: boolean } | { type: 'load-error'; requestId: number; error: unknown };
export function reduceProviderState(state: ProviderState, action: Action): ProviderState {
  if (action.type === 'edit') return { ...state, config: action.config, dirty: true, check: null, error: null };
  if (action.type === 'load-start') return { ...state, requestId: action.requestId, loading: true, error: null };
  if (action.requestId !== state.requestId) return state;
  if (action.type === 'load-error') return { ...state, loading: false, error: action.error };
  const preserve = state.dirty && !action.saved;
  return { ...state, config: preserve ? state.config : action.data.config ?? action.data.defaults, keyPresent: action.data.keyPresent, check: preserve ? null : action.data.check, dirty: preserve, loading: false, error: null };
}
