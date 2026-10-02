import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { buildThumbnailArgs, type AnyHighlightResult } from '@shotprompt/core';
import { videoDir } from './env';
import { runCmd } from './steps/spawn';
import type { PreparedCandidate } from './analysis-store';
import type { JobCtx } from './queue';
export async function prepareAnalysisThumbnails(videoId: string, runId: string, results: AnyHighlightResult[], ctx: JobCtx): Promise<PreparedCandidate[]> {
  const base = join(videoDir(videoId), 'thumbs'), temporary = join(base, `${runId}.tmp`), final = join(base, runId);
  await mkdir(temporary, { recursive: true });
  const rows: PreparedCandidate[] = [];
  for (const result of results) {
    ctx.signal.throwIfAborted();
    const id = crypto.randomUUID(), filename = `${id}.jpg`;
    await runCmd('ffmpeg', buildThumbnailArgs(join(videoDir(videoId), 'source.mp4'), (result.start + result.end) / 2, join(temporary, filename)), ctx);
    rows.push({ ...result, id, thumbnailPath: join(final, filename) });
  }
  ctx.signal.throwIfAborted();
  await rename(temporary, final);
  return rows;
}
export async function cleanupAnalysisThumbnails(videoId: string, runId: string): Promise<void> {
  const base = join(videoDir(videoId), 'thumbs');
  await rm(join(base, `${runId}.tmp`), { recursive: true, force: true });
  await rm(join(base, runId), { recursive: true, force: true });
}
