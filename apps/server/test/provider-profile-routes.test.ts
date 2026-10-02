import { expect, it } from 'bun:test';
import { createProfileDraft } from '@shotprompt/core';
import { createTestApp } from './helpers/app';

it('lists provider presets, creates a profile without leaking credential data, and rejects foreign origins', async () => {
  const { app, db } = createTestApp();
  try {
    const list = await app.handle(new Request('http://x/settings/analysis/profiles'));
    expect(list.status).toBe(200);
    const presetResponse = await app.handle(new Request('http://x/settings/analysis/providers'));
    const body: any = await presetResponse.json(); expect(body.presets.map((row: any) => row.id)).toEqual(['openrouter', 'gemini', 'ollama', 'local-compatible', 'custom']);
    const draft = createProfileDraft('local-compatible'); draft.config.model = 'local-model';
    const create = await app.handle(new Request('http://x/settings/analysis/profiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ draft, credential: { action: 'keep' } }) }));
    expect(create.status).toBe(200);
    const created = await create.json(); expect(JSON.stringify(created)).not.toContain('credentialVersion'); expect(JSON.stringify(created)).not.toContain('ciphertext');
    const foreign = await app.handle(new Request('http://x/settings/analysis/profiles', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: JSON.stringify({ draft, credential: { action: 'keep' } }) }));
    expect(foreign.status).toBe(403);
    const nullOrigin = await app.handle(new Request('http://x/settings/analysis/profiles', { method: 'POST', headers: { origin: 'null', 'content-type': 'application/json' }, body: JSON.stringify({ draft, credential: { action: 'keep' } }) }));
    expect(nullOrigin.status).toBe(403);
    const nonJson = await app.handle(new Request('http://x/settings/analysis/profiles', { method: 'POST', body: JSON.stringify({ draft, credential: { action: 'keep' } }) }));
    expect(nonJson.status).toBe(415);
  } finally { db.raw.close(); }
});

it('requires a current successful profile check before activation and validates stale revisions', async () => {
  const { app, db } = createTestApp();
  try {
    const draft = createProfileDraft('local-compatible'); draft.config.model = 'local-model';
    const response = await app.handle(new Request('http://x/settings/analysis/profiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ draft, credential: { action: 'keep' } }) }));
    const profile: any = await response.json();
    const activation = await app.handle(new Request('http://x/settings/analysis/active', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profileId: profile.id, expectedRevision: profile.revision }) }));
    expect(activation.status).toBe(409);
    const stale = await app.handle(new Request(`http://x/settings/analysis/profiles/${profile.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ draft: { ...draft, name: 'changed' }, credential: { action: 'keep' }, expectedRevision: profile.revision + 1 }) }));
    expect(stale.status).toBe(409);
  } finally { db.raw.close(); }
});
