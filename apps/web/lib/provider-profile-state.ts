import { createProfileDraft, type ModelCatalog, type ModelCatalogEntry, type ProfileDraft, type ProfileView, type ProviderPreset, type ProviderPresetId } from '@shotprompt/core';

export type ProviderEditorState = {
  profileId: string | null; expectedRevision: number | null; draft: ProfileDraft; credentialOperation: 'keep' | 'remove'; typedKey: string;
  dirty: boolean; editVersion: number; requestSerial: number; loading: string | null; check: ProfileView['check']; catalog: ModelCatalog | null; error: unknown;
};
export type EditorAction =
  | { type: 'edit'; draft: ProfileDraft }
  | { type: 'key'; value: string }
  | { type: 'remove-key' }
  | { type: 'destination'; patch: Partial<Pick<ProfileDraft['config'], 'baseUrl' | 'protocol' | 'inferenceLocation' | 'externalEnabled'>> }
  | { type: 'preset'; preset: ProviderPreset }
  | { type: 'loading'; kind: string | null; requestSerial: number }
  | { type: 'saved'; profile: ProfileView; requestSerial: number; editVersion: number }
  | { type: 'catalog'; catalog: ModelCatalog; requestSerial: number; editVersion: number }
  | { type: 'checked'; profile: ProfileView; requestSerial: number; editVersion: number }
  | { type: 'failed'; error: unknown; requestSerial: number; editVersion?: number }
  | { type: 'reset'; draft: ProfileDraft }
  | { type: 'close' };

export function createEditorState(draft: ProfileDraft, profile?: ProfileView): ProviderEditorState {
  return { profileId: profile?.id ?? null, expectedRevision: profile?.revision ?? null, draft: profile ? { name: profile.name, presetId: profile.presetId, config: { ...profile.config } } : draft, credentialOperation: 'keep', typedKey: '', dirty: !profile, editVersion: 0, requestSerial: 0, loading: null, check: profile?.check ?? null, catalog: null, error: null };
}
export function reduceProfileEditor(state: ProviderEditorState, action: EditorAction): ProviderEditorState {
  if (action.type === 'reset') return createEditorState(action.draft);
  if (action.type === 'close') return { ...createEditorState(createProfileDraft('openrouter')), dirty: false };
  if (action.type === 'edit') return { ...state, draft: action.draft, dirty: true, editVersion: state.editVersion + 1, loading: null, check: null, error: null };
  if (action.type === 'key') return { ...state, typedKey: action.value, credentialOperation: 'keep', dirty: true, editVersion: state.editVersion + 1, loading: null, check: null, error: null };
  if (action.type === 'remove-key') return { ...state, typedKey: '', credentialOperation: 'remove', dirty: true, editVersion: state.editVersion + 1, loading: null, check: null, error: null };
  if (action.type === 'destination') return changeCustomDestination(state, action.patch);
  if (action.type === 'preset') return changePreset(state, action.preset, createProfileDraft);
  if (action.type === 'loading') return { ...state, loading: action.kind, requestSerial: action.requestSerial, error: null };
  if (action.requestSerial !== state.requestSerial) return state;
  if (action.type === 'failed') return action.editVersion !== undefined && action.editVersion !== state.editVersion ? state : { ...state, loading: null, error: action.error };
  if (action.type === 'saved') {
    if (action.editVersion !== state.editVersion) return { ...state, profileId: action.profile.id, expectedRevision: action.profile.revision, typedKey: '', credentialOperation: 'keep', check: action.profile.check, loading: null };
    return { ...createEditorState({ name: action.profile.name, presetId: action.profile.presetId, config: action.profile.config }, action.profile), requestSerial: action.requestSerial };
  }
  if (action.type === 'catalog') return action.editVersion === state.editVersion ? { ...state, catalog: action.catalog, loading: null, error: null } : state;
  if (action.type === 'checked') return action.editVersion === state.editVersion ? { ...state, check: action.profile.check, loading: null, error: null } : state;
  return state;
}
export function filterModels(entries: ModelCatalogEntry[], query: string, schemaOnly = false): ModelCatalogEntry[] {
  const q = query.trim().toLocaleLowerCase();
  return entries.filter(entry => (!schemaOnly || entry.schemaSupport === 'supported') && (!q || `${entry.id}\n${entry.name}`.toLocaleLowerCase().includes(q)));
}
export function changePreset(state: ProviderEditorState, preset: ProviderPreset, createDraft: (id: ProviderPresetId) => ProfileDraft): ProviderEditorState {
  const next = createDraft(preset.id);
  next.name = state.draft.name; next.config.model = '';
  return reduceProfileEditor({ ...state, typedKey: '', credentialOperation: 'remove', catalog: null }, { type: 'edit', draft: next });
}
export function changeAdvancedUrl(state: ProviderEditorState, value: string): ProviderEditorState {
  return changeCustomDestination(state, { baseUrl: value });
}
export function changeCustomDestination(state: ProviderEditorState, patch: Partial<Pick<ProfileDraft['config'], 'baseUrl' | 'protocol' | 'inferenceLocation' | 'externalEnabled'>>): ProviderEditorState {
  const config = { ...state.draft.config, ...patch, presetId: 'custom' as const };
  const destinationChanged = config.baseUrl !== state.draft.config.baseUrl || config.protocol !== state.draft.config.protocol || config.inferenceLocation !== state.draft.config.inferenceLocation;
  const next = { ...state, typedKey: destinationChanged ? '' : state.typedKey, credentialOperation: destinationChanged ? 'remove' as const : state.credentialOperation, catalog: destinationChanged ? null : state.catalog };
  return reduceProfileEditor(next, { type: 'edit', draft: { ...state.draft, presetId: 'custom', config } });
}
export function credentialOperation(state: ProviderEditorState) {
  if (state.credentialOperation === 'remove') return { action: 'remove' as const };
  return state.typedKey.trim() ? { action: 'replace' as const, key: state.typedKey } : { action: 'keep' as const };
}
