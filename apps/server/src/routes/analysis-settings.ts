import { Elysia, status, t } from 'elysia';
import type { Ctx } from '../context';
import { PROVIDER_DEFAULTS, parseProviderConfig, providerFingerprint, readProviderCheck, readProviderConfig, saveProviderConfig } from '../ai/provider-settings';
import { AiAnalysisError, AiProviderError, getProviderPresets, parseProfileWrite, validateRuntimeProfile } from '@shotprompt/core';
import { checkProvider, createProviderClient } from '../ai/provider-client';
import { setSetting } from '../env';
import { createModelCatalogService } from '../ai/provider-catalog';
import { checkSavedProfile } from '../ai/provider-check';

function localOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return origin === null || origin === 'http://127.0.0.1:3100' || origin === 'http://localhost:3100';
}
function rejectMutation(request: Request) {
  if (!localOrigin(request)) return status(403, { error: 'origin-not-allowed' });
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return status(415, { error: 'json-required' });
  return null;
}
function failure(error: unknown, code = 'provider-unavailable') {
  const safeCode = error instanceof AiProviderError ? error.code : code;
  return status(safeCode === 'profile-not-found' ? 404 : safeCode === 'profile-in-use' || safeCode === 'profile-revision-conflict' || safeCode === 'profile-not-ready' || safeCode === 'profile-stale-check' ? 409 : 400, { error: safeCode });
}
export const analysisSettingsRoutes = (ctx: Ctx) => {
  const catalog = createModelCatalogService(ctx.profiles);
  return new Elysia()
  .get('/settings/analysis/providers', () => ({ presets: getProviderPresets(), defaults: PROVIDER_DEFAULTS }))
  .get('/settings/analysis/profiles', () => ctx.profiles.list())
  .post('/settings/analysis/profiles', ({ request, body }) => {
    const rejected = rejectMutation(request); if (rejected) return rejected;
    try { return ctx.profiles.create(parseProfileWrite(body)); } catch (error) { return failure(error, 'invalid-provider-profile'); }
  }, { body: t.Any() })
  .put('/settings/analysis/profiles/:id', ({ request, params, body }) => {
    const rejected = rejectMutation(request); if (rejected) return rejected;
    try { return ctx.profiles.update(params.id, parseProfileWrite(body)); } catch (error) { return failure(error, 'invalid-provider-profile'); }
  }, { body: t.Any() })
  .delete('/settings/analysis/profiles/:id', ({ request, params, query }) => {
    if (!localOrigin(request)) return status(403, { error: 'origin-not-allowed' });
    try { ctx.profiles.remove(params.id, Number(query.revision)); return { ok: true }; } catch (error) { return failure(error); }
  })
  .put('/settings/analysis/active', ({ request, body }) => {
    const rejected = rejectMutation(request); if (rejected) return rejected;
    try {
      const value = body as { profileId: string | null; expectedRevision?: number };
      if (!value || !(value.profileId === null || typeof value.profileId === 'string') || (value.profileId !== null && !Number.isInteger(value.expectedRevision))) return status(400, { error: 'invalid-provider-profile' });
      ctx.profiles.activate(value.profileId, value.expectedRevision); return ctx.profiles.list();
    } catch (error) { return failure(error); }
  }, { body: t.Any() })
  .post('/settings/analysis/profiles/:id/models', async ({ request, params, body }) => {
    if (!localOrigin(request)) return status(403, { error: 'origin-not-allowed' });
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return status(415, { error: 'json-required' });
    try {
      const value = body as { expectedRevision?: number; refresh?: boolean };
      if (!Number.isInteger(value?.expectedRevision) || (value.refresh !== undefined && typeof value.refresh !== 'boolean')) return status(400, { error: 'invalid-provider-profile' });
      return await catalog.load(params.id, value.expectedRevision as number, value.refresh === true);
    } catch (error) { return failure(error); }
  }, { body: t.Any() })
  .post('/settings/analysis/profiles/:id/check', async ({ request, params, body }) => {
    const rejected = rejectMutation(request); if (rejected) return rejected;
    try {
      const expectedRevision = (body as { expectedRevision?: number })?.expectedRevision;
      if (!Number.isInteger(expectedRevision)) return status(400, { error: 'invalid-provider-profile' });
      const profile = ctx.profiles.get(params.id);
      validateRuntimeProfile(profile);
      return await checkSavedProfile(ctx.profiles, profile.id, expectedRevision as number);
    } catch (error) { return failure(error); }
  }, { body: t.Any() })
  .get('/settings/analysis', () => {
    const registry = ctx.profiles.list();
    if (registry.profiles.length) {
      const profile = registry.profiles.find(row => row.id === registry.activeProfileId);
      let ready = false; try { ready = !!ctx.profiles.activeReady(); } catch { ready = false; }
      return { config: ready ? profile?.config ?? null : null, defaults: PROVIDER_DEFAULTS, keyPresent: ready ? profile?.keyPresent ?? false : false, check: profile?.check ?? null };
    }
    const config = readProviderConfig(ctx.db); return { config, defaults: PROVIDER_DEFAULTS, keyPresent: !!process.env.SHOTPROMPT_LLM_API_KEY, check: readProviderCheck(ctx.db, config) };
  })
  .put('/settings/analysis', ({ request, body }) => {
    const rejected = rejectMutation(request); if (rejected) return rejected;
    try {
      const config = parseProviderConfig(body);
      const registry = ctx.profiles.list(); if (!registry.activeProfileId) return status(409, { error: 'setup-required' });
      const old = ctx.profiles.get(registry.activeProfileId);
      ctx.profiles.update(old.id, { draft: { name: old.name, presetId: config.presetId ?? old.presetId, config }, expectedRevision: old.revision, credential: { action: 'keep' } });
      return { ok: true };
    }
    catch (error) { return error instanceof AiProviderError ? failure(error) : status(400, { message: 'invalid provider configuration' }); }
  }, { body: t.Any() })
  .post('/settings/analysis/check', async ({ request }) => {
    if (!localOrigin(request)) return status(403, { error: 'origin-not-allowed' });
    const registry = ctx.profiles.list();
    if (!registry.activeProfileId) return status(409, { message: 'provider-not-configured' });
    try { const profile = ctx.profiles.get(registry.activeProfileId); validateRuntimeProfile(profile); return await checkSavedProfile(ctx.profiles, profile.id, profile.revision); }
    catch (error) { return failure(error); }
  });
};
