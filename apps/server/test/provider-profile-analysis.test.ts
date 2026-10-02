import { expect, it } from 'bun:test';
import { createProfileDraft, parseAiAnalysisOptions } from '@shotprompt/core';
import { aiCredentials, analysisRuns, createDb, segments, videos } from '@shotprompt/db';
import { eq } from 'drizzle-orm';
import { createTestApp } from './helpers/app';
import { enqueueAiAnalysis } from '../src/analysis-enqueue';
import { createCredentialVault } from '../src/ai/credential-vault';
import { rmSync } from 'node:fs';

it('binds a queued analysis to its profile configuration and credential version after switching defaults', () => {
  const db = createDb(':memory:');
  const secretsDir = `/private/tmp/shotprompt-profile-run-${crypto.randomUUID()}`;
  const vault = createCredentialVault({ secretsDir, hasCredentials: () => db.select().from(aiCredentials).all().length > 0 });
  const { ctx } = createTestApp({ credentialVault: vault, db });
  try {
    db.insert(videos).values({ id: 'v', filename: 'v.mp4', path: '/tmp/v.mp4', language: 'th', duration: 30, status: 'ready', createdAt: 1 }).run();
    db.insert(segments).values({ videoId: 'v', start: 0, end: 30, text: 'เนื้อหาทดสอบ' }).run();
    function add(preset: 'openrouter' | 'gemini', model: string, key: string) {
      const draft = createProfileDraft(preset); draft.name = model; draft.config.externalEnabled = true; draft.config.model = model;
      const view = ctx.profiles.create({ draft, credential: { action: 'replace', key } });
      const profile = ctx.profiles.get(view.id);
      ctx.profiles.recordCheck(profile.id, profile.revision, { fingerprint: ctx.profiles.fingerprint(profile), revision: profile.revision, status: 'ready', checkedAt: 1, errorCode: null });
      ctx.profiles.activate(profile.id, profile.revision);
      return ctx.profiles.get(profile.id);
    }
    const a = add('openrouter', 'router-model', 'key-A');
    const queued = enqueueAiAnalysis(ctx, 'v', parseAiAnalysisOptions(undefined));
    const row = db.select().from(analysisRuns).where(eq(analysisRuns.id, queued.runId)).get()!;
    const snapshot = JSON.parse(row.evaluatorMetadataJson!).snapshot;
    expect(snapshot.provider).toMatchObject({ model: 'router-model', presetId: 'openrouter' });
    expect(snapshot.connection).toMatchObject({ profileId: a.id, credentialMode: 'stored', credentialVersion: a.credentialVersion });
    const b = add('gemini', 'gemini-model', 'key-B');
    expect(ctx.profiles.resolveCredential(snapshot)).toBe('key-A');
    const newProfile = ctx.profiles.activeReady()!;
    expect(newProfile.id).toBe(b.id);
    expect(JSON.stringify(row)).not.toContain('key-A'); expect(JSON.stringify(row)).not.toContain('key-B');
    expect(db.select().from(aiCredentials).all()).toHaveLength(2);
  } finally { db.raw.close(); rmSync(secretsDir, { recursive: true, force: true }); }
});
