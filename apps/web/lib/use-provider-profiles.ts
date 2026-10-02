'use client';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { createProfileDraft, type ModelCatalog, type ProfileDraft, type ProfileView, type ProviderPreset } from '@shotprompt/core';
import { API_BASE } from './api';
import { createEditorState, credentialOperation, reduceProfileEditor, type ProviderEditorState } from './provider-profile-state';

type ProfileList = { schemaVersion: 1; activeProfileId: string | null; profiles: ProfileView[]; migrationNotice: boolean };
type ProviderSetup = { presets: ProviderPreset[]; defaults: import('@shotprompt/core').ProviderConfig };
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers } });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw { status: response.status, value };
  return value as T;
}
const json = (value: unknown) => JSON.stringify(value);
export function useProviderProfiles() {
  const [registry, setRegistry] = useState<ProfileList | null>(null);
  const [providers, setProviders] = useState<ProviderSetup | null>(null);
  const [editor, dispatch] = useReducer(reduceProfileEditor, createProfileDraft('openrouter'), createEditorState);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  const editorRef = useRef(editor); editorRef.current = editor;
  const listSerial = useRef(0), editorSerial = useRef(0), editorSession = useRef(0), busyLock = useRef(false);
  const refresh = useCallback(async () => {
    const serial = ++listSerial.current; setLoading(true); setError(null);
    try {
      const [value, setup] = await Promise.all([request<ProfileList>('/settings/analysis/profiles'), request<ProviderSetup>('/settings/analysis/providers')]);
      if (serial === listSerial.current) { setRegistry(value); setProviders(setup); }
    }
    catch (reason) { if (serial === listSerial.current) setError(reason); }
    finally { if (serial === listSerial.current) setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); return () => { listSerial.current++; editorSerial.current++; }; }, [refresh]);
  const openNew = useCallback((presetId: ProfileDraft['presetId'] = 'openrouter') => { editorSerial.current++; editorSession.current++; dispatch({ type: 'reset', draft: createProfileDraft(presetId) }); setError(null); }, []);
  const openEdit = useCallback((profile: ProfileView) => { editorSerial.current++; editorSession.current++; dispatch({ type: 'reset', draft: { name: profile.name, presetId: profile.presetId, config: { ...profile.config } } }); dispatch({ type: 'saved', profile, requestSerial: 0, editVersion: 0 }); setError(null); }, []);
  const close = useCallback(() => { editorSerial.current++; editorSession.current++; dispatch({ type: 'close' }); }, []);
  const edit = useCallback((draft: ProfileDraft) => dispatch({ type: 'edit', draft }), []);
  const changeDestination = useCallback((patch: Partial<Pick<ProfileDraft['config'], 'baseUrl' | 'protocol' | 'inferenceLocation' | 'externalEnabled'>>) => dispatch({ type: 'destination', patch }), []);
  const selectPreset = useCallback((preset: ProviderPreset) => dispatch({ type: 'preset', preset }), []);
  const setKey = useCallback((value: string) => dispatch({ type: 'key', value }), []);
  const removeKey = useCallback(() => dispatch({ type: 'remove-key' }), []);
  async function save(): Promise<ProfileView> {
    const before = editorRef.current; if (busyLock.current || before.loading === 'saving') throw new Error('profile-save-busy');
    const serial = ++editorSerial.current, editVersion = before.editVersion; dispatch({ type: 'loading', kind: 'saving', requestSerial: serial }); setBusy(true);
    busyLock.current = true;
    try {
      const body = { draft: before.draft, credential: credentialOperation(before), ...(before.expectedRevision === null ? {} : { expectedRevision: before.expectedRevision }) };
      const profile = await request<ProfileView>(before.profileId ? `/settings/analysis/profiles/${encodeURIComponent(before.profileId)}` : '/settings/analysis/profiles', { method: before.profileId ? 'PUT' : 'POST', body: json(body) });
      dispatch({ type: 'saved', profile, requestSerial: serial, editVersion }); await refresh(); return profile;
    } catch (reason) { dispatch({ type: 'failed', error: reason, requestSerial: serial, editVersion }); throw reason; }
    finally { busyLock.current = false; setBusy(false); }
  }
  async function prepareSaved(): Promise<ProfileView> {
    const current = editorRef.current;
    if (current.profileId && !current.dirty) {
      const profile = registry?.profiles.find(row => row.id === current.profileId);
      if (profile) return profile;
    }
    return save();
  }
  async function loadModels(refreshCatalog = false): Promise<ModelCatalog> {
    const session = editorSession.current;
    const profile = await prepareSaved();
    if (session !== editorSession.current) throw new Error('profile-editor-changed');
    const serial = ++editorSerial.current, editVersion = editorRef.current.editVersion; dispatch({ type: 'loading', kind: 'catalog', requestSerial: serial });
    try { const catalog = await request<ModelCatalog>(`/settings/analysis/profiles/${encodeURIComponent(profile.id)}/models`, { method: 'POST', body: json({ expectedRevision: profile.revision, refresh: refreshCatalog }) }); dispatch({ type: 'catalog', catalog, requestSerial: serial, editVersion }); return catalog; }
    catch (reason) { dispatch({ type: 'failed', error: reason, requestSerial: serial, editVersion }); throw reason; }
  }
  async function check(): Promise<ProfileView> {
    const session = editorSession.current;
    const profile = await prepareSaved();
    if (session !== editorSession.current) throw new Error('profile-editor-changed');
    const serial = ++editorSerial.current, editVersion = editorRef.current.editVersion; dispatch({ type: 'loading', kind: 'check', requestSerial: serial });
    try { const checked = await request<ProfileView>(`/settings/analysis/profiles/${encodeURIComponent(profile.id)}/check`, { method: 'POST', body: json({ expectedRevision: profile.revision }) }); dispatch({ type: 'checked', profile: checked, requestSerial: serial, editVersion }); await refresh(); return checked; }
    catch (reason) { dispatch({ type: 'failed', error: reason, requestSerial: serial, editVersion }); throw reason; }
  }
  async function activate(profile: ProfileView): Promise<void> {
    await request('/settings/analysis/active', { method: 'PUT', body: json({ profileId: profile.id, expectedRevision: profile.revision }) }); await refresh();
  }
  async function remove(profile: ProfileView): Promise<void> {
    await request(`/settings/analysis/profiles/${encodeURIComponent(profile.id)}?revision=${profile.revision}`, { method: 'DELETE' }); await refresh();
    if (editorRef.current.profileId === profile.id) close();
  }
  const editorState: ProviderEditorState = editor;
  return { registry, presets: providers?.presets ?? [], defaults: providers?.defaults ?? null, editor: editorState, loading, busy, error, refresh, openNew, openEdit, close, edit, changeDestination, selectPreset, setKey, removeKey, save, loadModels, check, activate, remove };
}
