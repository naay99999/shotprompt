import { and, desc, eq } from 'drizzle-orm';
import { analysisRuns, jobs, videos, type DB } from '@shotprompt/db';
import { parseAnalysisOptions } from '@shotprompt/core';
import { createAnalysisRun } from '../analysis-store';
import { runAnalysis } from '../analysis-service';
import type { JobCtx } from '../queue';
export function satisfied(_db: DB, _videoId: string): boolean { return false; }
export async function run(db: DB, videoId: string, ctx: JobCtx) {
  const video = db.select().from(videos).where(eq(videos.id, videoId)).get()!;
  const job = db.select().from(jobs).where(and(eq(jobs.videoId, videoId), eq(jobs.type, 'pipeline'), eq(jobs.status, 'running'))).orderBy(desc(jobs.createdAt)).get();
  if (!job) throw new Error('pipeline job not found');
  const previous = db.select().from(analysisRuns).where(eq(analysisRuns.jobId, job.id)).get();
  if (previous?.status === 'done') return;
  const options = parseAnalysisOptions(video.analysisOptionsJson ? JSON.parse(video.analysisOptionsJson) : undefined);
  const analysis = createAnalysisRun(db, videoId, job.id, options);
  await runAnalysis(db, analysis.id, ctx);
}
