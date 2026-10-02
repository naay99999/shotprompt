import { eq } from 'drizzle-orm';
import { analysisRuns, jobs, videos } from '@shotprompt/db';
import { AiAnalysisError, legacyOptionsToAi, parseStoredAnalysisOptions, type AiAnalysisOptions } from '@shotprompt/core';
import type { Ctx } from './context';
import { AnalysisError, assertNoActiveVideoWork, createAnalysisRun, readVideo } from './analysis-store';
import { createEvaluatorSnapshot, readProviderConfig } from './ai/provider-settings';
export function enqueueAiAnalysis(ctx: Ctx, videoId: string, options: AiAnalysisOptions, triggerPipelineJobId?: string): { runId: string; jobId: string } {
  const result = ctx.db.raw.transaction(() => {
    const video = readVideo(ctx.db, videoId); assertNoActiveVideoWork(ctx.db, videoId);
    if (video.status !== 'ready') throw new AnalysisError('source-not-ready', 'source not ready');
    const registry = ctx.profiles.list();
    const profile = registry.activeProfileId ? ctx.profiles.activeReady() : null;
    const config = profile?.config ?? (registry.profiles.length === 0 ? readProviderConfig(ctx.db) : null);
    if (!config) throw new AiAnalysisError('provider-not-configured');
    const snapshot = createEvaluatorSnapshot(config, triggerPipelineJobId);
    if (profile) snapshot.connection = ctx.profiles.snapshot(profile);
    const jobId = crypto.randomUUID(), run = createAnalysisRun(ctx.db, videoId, jobId, options, snapshot);
    ctx.db.insert(jobs).values({ id: jobId, videoId, type: 'analysis', status: 'queued', createdAt: Date.now() }).run();
    ctx.db.update(videos).set({ analysisOptionsJson: JSON.stringify(options) }).where(eq(videos.id, videoId)).run();
    return { runId: run.id, jobId };
  })();
  ctx.analysisQueue.enqueue(result.jobId); return result;
}
export function schedulePipelineAnalysis(ctx: Ctx, completedJobId: string): void {
  const job = ctx.db.select().from(jobs).where(eq(jobs.id, completedJobId)).get();
  if (!job || job.type !== 'pipeline' || job.status !== 'done') return;
  const registry = ctx.profiles.list();
  if (registry.profiles.length > 0) {
    try { if (!ctx.profiles.activeReady()) return; } catch { return; }
  } else if (!readProviderConfig(ctx.db)) return;
  const triggered = ctx.db.select().from(analysisRuns).where(eq(analysisRuns.videoId, job.videoId)).all().some(run => {
    if (!run.evaluatorMetadataJson) return false;
    return JSON.parse(run.evaluatorMetadataJson).snapshot?.triggerPipelineJobId === completedJobId;
  });
  if (triggered) return;
  const video = readVideo(ctx.db, job.videoId), saved = parseStoredAnalysisOptions(video.analysisOptionsJson ? JSON.parse(video.analysisOptionsJson) : undefined);
  const options = 'instruction' in saved ? saved : legacyOptionsToAi(saved);
  try { enqueueAiAnalysis(ctx, job.videoId, options, completedJobId); }
  catch (error) { if (error instanceof AnalysisError && error.code === 'active-job') return; throw error; }
}
