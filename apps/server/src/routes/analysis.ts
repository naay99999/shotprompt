import { Elysia, status, t } from 'elysia';
import { and, desc, eq } from 'drizzle-orm';
import { analysisRuns, candidateFeedback, candidates, jobs, videos } from '@shotprompt/db';
import { AiAnalysisError, AiProviderError, ANALYSIS_PROFILES, CATEGORY_LABELS, DEFAULT_ANALYSIS_OPTIONS, DEFAULT_AI_ANALYSIS_OPTIONS, AI_WEIGHTS, GOAL_LABELS, parseAiAnalysisOptions, type AiAnalysisOptions, type FeedbackVerdict } from '@shotprompt/core';
import { readProviderConfig } from '../ai/provider-settings';
import { enqueueAiAnalysis } from '../analysis-enqueue';
import type { Ctx } from '../context';
import { AnalysisError, assertNoActiveVideoWork, createAnalysisRun, readVideo, runView } from '../analysis-store';
export function analysisErrorResponse(error: unknown) {
  if (error instanceof AiAnalysisError) return status(error.code === 'unsupported-options' ? 400 : 409, { message: error.code });
  if (error instanceof AiProviderError) return status(error.code === 'invalid-provider-profile' ? 400 : 409, { message: error.code });
  if (error instanceof AnalysisError) return status(error.code === 'not-found' ? 404 : error.code === 'invalid-options' ? 400 : 409, { message: error.message, jobId: error.jobId });
  if (error instanceof Error && error.message === 'invalid analysis options') return status(400, { message: error.message });
  throw error;
}
export const analysisRoutes = (ctx: Ctx) => new Elysia()
  .get('/analysis/profiles', () => {
    const registry = ctx.profiles.list(); let configured = false;
    if (registry.profiles.length) { try { configured = !!ctx.profiles.activeReady(); } catch { configured = false; } }
    else configured = !!readProviderConfig(ctx.db);
    return { profiles: ANALYSIS_PROFILES, categoryLabels: CATEGORY_LABELS, goalLabels: GOAL_LABELS, defaults: DEFAULT_AI_ANALYSIS_OPTIONS, legacyDefaults: DEFAULT_ANALYSIS_OPTIONS, rubric: AI_WEIGHTS, configured, semantic: configured, scoringLanguages: [] as string[] };
  })
  .post('/videos/:id/analysis', ({ params, body }) => {
    try {
      if (!body || typeof body !== 'object' || (body as { schemaVersion?: unknown }).schemaVersion !== 2) throw new AiAnalysisError('unsupported-options');
      return status(202, enqueueAiAnalysis(ctx, params.id, parseAiAnalysisOptions(body)));
    }
    catch (error) { return analysisErrorResponse(error); }
  }, { body: t.Optional(t.Any()) })
  .get('/videos/:id/analysis', ({ params }) => {
    try {
      const video = readVideo(ctx.db, params.id);
      const history = ctx.db.select().from(analysisRuns).where(eq(analysisRuns.videoId, params.id)).orderBy(desc(analysisRuns.createdAt), desc(analysisRuns.id)).limit(20).all().map(runView);
      const activeRow = video.activeAnalysisRunId ? ctx.db.select().from(analysisRuns).where(and(eq(analysisRuns.id, video.activeAnalysisRunId), eq(analysisRuns.videoId, video.id), eq(analysisRuns.status, 'done'))).get() : null;
      return { active: activeRow ? runView(activeRow) : null, latest: history[0] ?? null, history };
    } catch (error) { return analysisErrorResponse(error); }
  })
  .put('/videos/:id/candidates/:candidateId/feedback', ({ params, body }) => {
    try {
      const row = ctx.db.select().from(candidates).where(and(eq(candidates.id, params.candidateId), eq(candidates.videoId, params.id))).get();
      if (!row) throw new AnalysisError('not-found', 'candidate not found');
      const verdict = body && typeof body === 'object' ? (body as { verdict?: unknown }).verdict : null;
      if (!['good', 'irrelevant', 'starts-mid-thought', 'ends-too-soon', 'duplicate'].includes(verdict as string)) return status(400, { message: 'invalid feedback' });
      const values = { candidateId: row.id, videoId: params.id, runId: row.runId, verdict: verdict as FeedbackVerdict, updatedAt: Date.now() };
      ctx.db.insert(candidateFeedback).values(values).onConflictDoUpdate({ target: candidateFeedback.candidateId, set: { verdict: values.verdict, updatedAt: values.updatedAt } }).run();
      return { ok: true };
    } catch (error) { return analysisErrorResponse(error); }
  }, { body: t.Any() })
  .delete('/videos/:id/candidates/:candidateId/feedback', ({ params }) => {
    const row = ctx.db.select().from(candidates).where(and(eq(candidates.id, params.candidateId), eq(candidates.videoId, params.id))).get();
    if (!row) return status(404, { message: 'candidate not found' });
    ctx.db.delete(candidateFeedback).where(eq(candidateFeedback.candidateId, row.id)).run(); return { ok: true };
  });
