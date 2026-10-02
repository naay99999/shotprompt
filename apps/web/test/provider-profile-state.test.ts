import { expect, it } from 'bun:test';
import { createProfileDraft } from '@shotprompt/core';
import { changeAdvancedUrl, changeCustomDestination, changePreset, createEditorState, credentialOperation, filterModels, reduceProfileEditor } from '../lib/provider-profile-state';

const catalog = { entries: [
  { id: 'provider/ไทย', name: 'Thai Vision', contextLength: null, inputUsdPerMillion: 0, outputUsdPerMillion: null, textCapability: 'unknown' as const, schemaSupport: 'unknown' as const },
  { id: 'provider/json', name: 'JSON model', contextLength: 100, inputUsdPerMillion: null, outputUsdPerMillion: null, textCapability: 'supported' as const, schemaSupport: 'supported' as const },
], fetchedAt: 1, truncated: false, stale: false };

it('keeps stale requests from replacing newer edits or another editor request', () => {
  const initial = createEditorState(createProfileDraft('openrouter'));
  const loading = reduceProfileEditor(initial, { type: 'loading', kind: 'catalog', requestSerial: 3 });
  const changed = reduceProfileEditor(loading, { type: 'edit', draft: { ...loading.draft, config: { ...loading.draft.config, model: 'manual-model' } } });
  expect(changed.loading).toBeNull();
  expect(reduceProfileEditor(changed, { type: 'catalog', catalog, requestSerial: 3, editVersion: 0 })).toBe(changed);
  expect(reduceProfileEditor(changed, { type: 'failed', error: 'late', requestSerial: 3, editVersion: 0 })).toBe(changed);
  expect(changed.draft.config.model).toBe('manual-model');
  expect(reduceProfileEditor(changed, { type: 'failed', error: 'late', requestSerial: 2 })).toBe(changed);
});

it('preserves explicit credentials, clears provider association and keeps manual models through catalog errors', () => {
  let state = createEditorState(createProfileDraft('openrouter'));
  state = { ...state, catalog };
  state = reduceProfileEditor(state, { type: 'key', value: 'secret' });
  expect(credentialOperation(state)).toEqual({ action: 'replace', key: 'secret' });
  const preset = { id: 'gemini', name: 'Gemini', protocol: 'openai-compatible', inferenceLocation: 'external', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', credentialRequired: true, documentationUrl: '', apiKeyUrl: null } as const;
  state = changePreset(state, preset, id => createProfileDraft(id));
  expect(state.typedKey).toBe(''); expect(state.draft.config.model).toBe(''); expect(state.draft.presetId).toBe('gemini');
  expect(state.catalog).toBeNull(); expect(state.credentialOperation).toBe('remove');
  state = { ...state, draft: { ...state.draft, config: { ...state.draft.config, model: 'manual-entry' } } };
  state = reduceProfileEditor(state, { type: 'failed', error: 'catalog unavailable', requestSerial: state.requestSerial });
  expect(state.draft.config.model).toBe('manual-entry');
  state = { ...state, typedKey: 'must-not-follow-destination', catalog };
  const changedDestination = changeAdvancedUrl(state, 'https://api.example/v1');
  expect(changedDestination.draft.presetId).toBe('custom');
  expect(changedDestination.typedKey).toBe(''); expect(changedDestination.catalog).toBeNull();
  expect(credentialOperation(changedDestination)).toEqual({ action: 'remove' });
  const changedProtocol = changeCustomDestination({ ...changedDestination, typedKey: 'another-secret' }, { protocol: 'ollama' });
  expect(changedProtocol.typedKey).toBe('');
  expect(changedProtocol.credentialOperation).toBe('remove');
});

it('filters Unicode names and IDs without treating unknown schema support as supported', () => {
  expect(filterModels(catalog.entries, 'ไทย')).toHaveLength(1);
  expect(filterModels(catalog.entries, 'provider/')).toHaveLength(2);
  expect(filterModels(catalog.entries, '', true).map(row => row.id)).toEqual(['provider/json']);
  expect(catalog.entries[0].inputUsdPerMillion).toBe(0);
});
