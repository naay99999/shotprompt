import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { analysisRuns, candidateFeedback, candidates, jobs, scenes, segments, videos, type DB } from '@shotprompt/db';
import { parseStoredAnalysisOptions, type AnalysisSource, type StoredAnalysisOptions, type EvaluatorSnapshot, type EvaluatorMetadata, type AnalysisAssessment, type AnyHighlightResult, type AnalysisRunView, type CandidateView, type FeedbackVerdict, } from '@shotprompt/core';
export class AnalysisError extends Error {
  constructor(public code: 'not-found' | 'invalid-options' | 'source-not-ready' | 'active-job' | 'source-changed' | 'invalid-state', message: string, public jobId?: string) { super(message); }
}
export type PreparedCandidate = AnyHighlightResult & { id: string; thumbnailPath: string };
export function readVideo(db: DB, videoId: string) {
  const video = db.select().from(videos).where(eq(videos.id, videoId)).get();
  if (!video) throw new AnalysisError('not-found', 'video not found');
  return video;
}
export function loadAnalysisInput<T extends StoredAnalysisOptions>(db: DB, videoId: string, options: T): AnalysisSource & { options: T } {
  const video = readVideo(db, videoId);
  if (video.duration == null || !Number.isFinite(video.duration) || video.duration <= 0) throw new AnalysisError('source-not-ready', 'source not ready');
  return { duration: video.duration, language: video.language, options,
    segments: db.select().from(segments).where(eq(segments.videoId, videoId)).all().sort((a, b) => a.start - b.start || a.id - b.id),
    scenes: db.select().from(scenes).where(eq(scenes.videoId, videoId)).all().map(s => s.time).sort((a, b) => a - b) };
}
export function sourceRevision(input: AnalysisSource & { options?: StoredAnalysisOptions }): string {
  const source = { duration: input.duration, language: input.language, segments: [...input.segments].sort((a, b) => a.start - b.start || a.id - b.id).map(({ id, start, end, text }) => ({ id, start, end, text })), scenes: [...input.scenes].sort((a, b) => a - b) };
  return createHash('sha256').update(JSON.stringify(source)).digest('hex');
}
export function runView(row: typeof analysisRuns.$inferSelect): AnalysisRunView {
  return { id: row.id, videoId: row.videoId, jobId: row.jobId, status: row.status as AnalysisRunView['status'], options: parseStoredAnalysisOptions(JSON.parse(row.optionsJson)), evaluatorMetadata: row.evaluatorMetadataJson ? JSON.parse(row.evaluatorMetadataJson) : null, progress: row.progressJson ? JSON.parse(row.progressJson) : null, engineVersion: row.engineVersion, sourceRevision: row.sourceRevision, createdAt: row.createdAt, completedAt: row.completedAt, error: row.error };
}
export function createAnalysisRun(db: DB, videoId: string, jobId: string, options: StoredAnalysisOptions, snapshot: EvaluatorSnapshot | null = null): AnalysisRunView {
  const input = loadAnalysisInput(db, videoId, options);
  return runView(db.insert(analysisRuns).values({ id: crypto.randomUUID(), videoId, jobId, status: 'queued', optionsJson: JSON.stringify(options), engineVersion: snapshot ? 'llm-v1' : 'rules-v1', evaluatorMetadataJson: snapshot ? JSON.stringify({ snapshot, reportedModels: [], usage: { inputTokens: null, outputTokens: null }, requestCount: 0, elapsedMs: 0 }) : null, sourceRevision: sourceRevision(input), createdAt: Date.now() }).returning().get());
}
export function assertNoActiveVideoWork(db: DB, videoId: string): void {
  const job = db.select().from(jobs).where(and(eq(jobs.videoId, videoId), inArray(jobs.type, ['pipeline', 'analysis']), inArray(jobs.status, ['queued', 'running']))).get();
  if (job) throw new AnalysisError('active-job', 'analysis or pipeline job active', job.id);
}
export function publishAnalysisRun(db: DB, runId: string, input: AnalysisSource & { options: StoredAnalysisOptions }, rows: PreparedCandidate[], signal?: AbortSignal, metadata?: EvaluatorMetadata | null): void {
  db.raw.transaction(() => {
    signal?.throwIfAborted();
    const run = db.select().from(analysisRuns).where(eq(analysisRuns.id, runId)).get();
    if (!run || run.status !== 'running') throw new AnalysisError('invalid-state', 'analysis is not running');
    if (run.sourceRevision !== sourceRevision(input) || run.sourceRevision !== sourceRevision(loadAnalysisInput(db, run.videoId, input.options))) throw new AnalysisError('source-changed', 'source changed');
    const ids = new Map(rows.map(r => [r.key, r.id]));
    for (const r of rows) db.insert(candidates).values({ id: r.id, videoId: run.videoId, runId, start: r.start, end: r.end, score: r.score, thumbnailPath: r.thumbnailPath, rank: r.rank, isPrimary: r.isPrimary, assessmentJson: JSON.stringify({ ...r.assessment, suppressedBy: r.assessment.suppressedBy ? ids.get(r.assessment.suppressedBy) ?? null : null }) }).run();
    db.update(analysisRuns).set({ status: 'done', completedAt: Date.now(), error: null, ...(metadata ? { evaluatorMetadataJson: JSON.stringify(metadata) } : {}) }).where(eq(analysisRuns.id, runId)).run();
    db.update(videos).set({ activeAnalysisRunId: runId }).where(eq(videos.id, run.videoId)).run();
  })();
}
export function listCandidates(db: DB, videoId: string, runId?: string, includeSuppressed = false): CandidateView[] {
  const video = readVideo(db, videoId), selected = runId ?? video.activeAnalysisRunId;
  if (selected) {
    const run = db.select().from(analysisRuns).where(and(eq(analysisRuns.id, selected), eq(analysisRuns.videoId, videoId), eq(analysisRuns.status, 'done'))).get();
    if (!run) throw new AnalysisError('not-found', 'analysis run not found');
  }
  const rows = db.select().from(candidates).where(and(eq(candidates.videoId, videoId), selected ? eq(candidates.runId, selected) : isNull(candidates.runId))).orderBy(asc(candidates.rank), desc(candidates.score), asc(candidates.start)).all();
  const feedback = new Map(db.select().from(candidateFeedback).where(eq(candidateFeedback.videoId, videoId)).all().map(f => [f.candidateId, f.verdict as FeedbackVerdict]));
  return rows.filter(r => includeSuppressed || r.isPrimary).map(r => ({ ...r, assessment: r.assessmentJson ? JSON.parse(r.assessmentJson) as AnalysisAssessment : null, feedback: feedback.get(r.id) ?? null }));
}
