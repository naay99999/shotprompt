import { Elysia, status, t } from 'elysia'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { and, desc, eq, inArray } from 'drizzle-orm'
import {
  analysisRuns, candidateFeedback, candidates, clipSubtitles, clips, exportsTable, jobs, jobSteps, scenes, segments, videos,
} from '@shotprompt/db'
import { parseAiAnalysisOptions, getLanguageName, isLanguage, isWhisperModel } from '@shotprompt/core'
import { assertNoActiveVideoWork, listCandidates } from '../analysis-store'
import { analysisErrorResponse } from './analysis'
import type { Ctx } from '../context'
import { getSetting, videoDir } from '../env'

const ACTIVE_STATUSES = ['queued', 'running']

function activePipelineJob(ctx: Ctx, videoId: string) {
  return ctx.db.select().from(jobs).where(eq(jobs.videoId, videoId)).all()
    .find(job => ['pipeline', 'analysis'].includes(job.type) && ACTIVE_STATUSES.includes(job.status))
}

function queueFullPipeline(ctx: Ctx, videoId: string) {
  ctx.db.delete(scenes).where(eq(scenes.videoId, videoId)).run()
  ctx.db.delete(segments).where(eq(segments.videoId, videoId)).run()
  const jobId = crypto.randomUUID()
  ctx.db.insert(jobs).values({ id: jobId, videoId, type: 'pipeline', status: 'queued', createdAt: Date.now() }).run()
  return jobId
}

function modelSelectionError(ctx: Ctx, model: unknown): string | null {
  if (!isWhisperModel(model)) return 'unsupported model'
  if (!ctx.modelAvailable(model)) return 'model not downloaded'
  return null
}

function requestedModel(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || !('model' in body)) return undefined
  return (body as { model?: unknown }).model
}

function queueSelectedPipeline(ctx: Ctx, videoId: string, model: unknown) {
  if (model !== undefined) {
    if (!isWhisperModel(model)) return status(400, { message: 'unsupported model' })
    if (!ctx.modelAvailable(model)) return status(400, { message: 'model not downloaded' })
    ctx.db.update(videos).set({ whisperModel: model }).where(eq(videos.id, videoId)).run()
  }
  try {
    const result = ctx.db.raw.transaction(() => {
      assertNoActiveVideoWork(ctx.db, videoId)
      return { jobId: queueFullPipeline(ctx, videoId) }
    })()
    ctx.pipelineQueue.enqueue(result.jobId)
    return result
  } catch (error) { return analysisErrorResponse(error) }
}

export const videoRoutes = (ctx: Ctx) => new Elysia()
  .post('/videos', async ({ body, request }) => {
    const contentType = request.headers.get('content-type') ?? ''
    const isMultipart = contentType.includes('multipart/form-data')
    const b = body as Record<string, unknown>

    let file: File | undefined
    let sourcePath: string | undefined
    let filename: string
    if (isMultipart) {
      file = b.file as File | undefined
      if (!file) return status(400, { message: 'file is required' })
      filename = file.name
    } else {
      sourcePath = b.path as string | undefined
      if (!sourcePath || !existsSync(sourcePath)) return status(400, { message: 'file not found: ' + sourcePath })
      filename = basename(sourcePath)
    }

    let analysisOptions
    try { analysisOptions = parseAiAnalysisOptions(isMultipart && typeof b.analysisOptions === 'string' ? JSON.parse(b.analysisOptions) : b.analysisOptions) }
    catch { return status(400, { message: 'invalid analysis options' }) }
    const language = String(b.language ?? '')
    if (!isLanguage(language)) return status(400, { message: 'unsupported language' })

    const requestedWhisperModel = b.model
    if (requestedWhisperModel !== undefined) {
      const error = modelSelectionError(ctx, requestedWhisperModel)
      if (error) return status(400, { message: error })
    }
    const whisperModel = requestedWhisperModel === undefined
      ? getSetting(ctx.db, 'whisperModel', 'large-v3')
      : String(requestedWhisperModel)

    const id = crypto.randomUUID()
    mkdirSync(videoDir(id), { recursive: true })
    const extension = extname(file?.name ?? sourcePath!)
    const uploadPath = join(videoDir(id), 'upload' + extension)
    if (file) await Bun.write(uploadPath, file)
    else await Bun.write(uploadPath, Bun.file(sourcePath!))

    ctx.db.insert(videos).values({ id, filename, path: uploadPath, status: 'uploaded', language, whisperModel, analysisOptionsJson: JSON.stringify(analysisOptions), createdAt: Date.now() }).run()
    const jobId = crypto.randomUUID()
    ctx.db.insert(jobs).values({ id: jobId, videoId: id, type: 'pipeline', status: 'queued', createdAt: Date.now() }).run()
    ctx.pipelineQueue.enqueue(jobId)

    const video = ctx.db.select().from(videos).where(eq(videos.id, id)).get()
    return { video, jobId }
  })
  .get('/videos', () => {
    const rows = ctx.db.select().from(videos).orderBy(desc(videos.createdAt)).all()
    return rows.map(v => ({
      ...v,
      languageName: getLanguageName(v.language),
      clipCount: ctx.db.select().from(clips).where(eq(clips.videoId, v.id)).all().length,
    }))
  })
  .get('/videos/:id', ({ params }) => {
    const video = ctx.db.select().from(videos).where(eq(videos.id, params.id)).get()
    if (!video) return status(404, { message: 'not found' })
    const job = ctx.db.select().from(jobs).where(and(eq(jobs.videoId, params.id), eq(jobs.type, 'pipeline'))).orderBy(desc(jobs.createdAt)).get()
    const steps = job ? ctx.db.select().from(jobSteps).where(eq(jobSteps.jobId, job.id)).orderBy(jobSteps.id).all() : []
    const candidateCount = listCandidates(ctx.db, params.id).length
    return { video: { ...video, languageName: getLanguageName(video.language) }, job: job ? { ...job, steps } : null, candidateCount }
  })
  .delete('/videos/:id', ({ params }) => {
    const video = ctx.db.select().from(videos).where(eq(videos.id, params.id)).get()
    if (!video) return status(404, { message: 'not found' })

    const latestJob = ctx.db.select().from(jobs).where(and(eq(jobs.videoId, params.id), inArray(jobs.status, ACTIVE_STATUSES))).get()
    if (latestJob && ACTIVE_STATUSES.includes(latestJob.status)) return status(409, { message: 'job active' })

    ctx.db.raw.transaction(() => {
    const jobIds = ctx.db.select().from(jobs).where(eq(jobs.videoId, params.id)).all().map(j => j.id)
    if (jobIds.length) ctx.db.delete(jobSteps).where(inArray(jobSteps.jobId, jobIds)).run()

    const clipIds = ctx.db.select().from(clips).where(eq(clips.videoId, params.id)).all().map(c => c.id)
    if (clipIds.length) {
      ctx.db.delete(clipSubtitles).where(inArray(clipSubtitles.clipId, clipIds)).run()
      ctx.db.delete(exportsTable).where(inArray(exportsTable.clipId, clipIds)).run()
    }

    ctx.db.delete(clips).where(eq(clips.videoId, params.id)).run()
    ctx.db.delete(candidateFeedback).where(eq(candidateFeedback.videoId, params.id)).run()
    ctx.db.delete(candidates).where(eq(candidates.videoId, params.id)).run()
    ctx.db.delete(analysisRuns).where(eq(analysisRuns.videoId, params.id)).run()
    ctx.db.delete(scenes).where(eq(scenes.videoId, params.id)).run()
    ctx.db.delete(segments).where(eq(segments.videoId, params.id)).run()
    ctx.db.delete(jobs).where(eq(jobs.videoId, params.id)).run()
    ctx.db.delete(videos).where(eq(videos.id, params.id)).run()
    })()

    rmSync(videoDir(params.id), { recursive: true, force: true })
    return { ok: true }
  })
  .post('/videos/:id/retry', ({ params, body }) => {
    const video = ctx.db.select().from(videos).where(eq(videos.id, params.id)).get()
    if (!video) return status(404, { message: 'not found' })
    const activeJob = activePipelineJob(ctx, params.id)
    if (activeJob) return status(409, { message: 'pipeline job already active', jobId: activeJob.id })
    return queueSelectedPipeline(ctx, params.id, requestedModel(body))
  }, { body: t.Optional(t.Object({ model: t.Optional(t.String()) })) })
  .post('/videos/:id/repair', ({ params, body }) => {
    const video = ctx.db.select().from(videos).where(eq(videos.id, params.id)).get()
    if (!video) return status(404, { message: 'not found' })
    const activeJob = activePipelineJob(ctx, params.id)
    if (activeJob) return status(409, { message: 'pipeline job already active', jobId: activeJob.id })
    return queueSelectedPipeline(ctx, params.id, requestedModel(body))
  }, { body: t.Optional(t.Object({ model: t.Optional(t.String()) })) })
  .get('/videos/:id/thumb/:file', ({ params }) => {
    const { file } = params
    if (basename(file) !== file) return status(400, { message: 'invalid file' })
    const candidate = ctx.db.select().from(candidates).where(and(eq(candidates.id, file.replace(/\.jpg$/, '')), eq(candidates.videoId, params.id))).get()
    const path = candidate?.thumbnailPath ?? join(videoDir(params.id), 'thumbs', file)
    if (!existsSync(path)) return status(404, { message: 'not found' })
    return Bun.file(path)
  })
  .get('/videos/:id/stream', ({ params, set }) => {
    const v = ctx.db.select().from(videos).where(eq(videos.id, params.id)).get()
    if (!v) return status(404, { message: 'not found' })

    // Return the raw Bun.file() Blob and let Elysia's built-in file/Range handling
    // (adapter handleFile) do the 206/Content-Range slicing. Manually constructing
    // `new Response(file.slice(...), ...)` here is unsafe: once any global plugin
    // (e.g. @elysiajs/cors) sets response headers, Elysia rewraps the handler's
    // Response via `new Response(response.body, ...)`, and re-deriving `.body` from
    // an already-sliced Bun.file Blob silently drops the slice bounds, streaming the
    // rest of the file instead of just the requested range.
    set.headers['content-type'] = 'video/mp4'
    return Bun.file(v.path)
  })
