import { Elysia, status } from 'elysia'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { desc, eq, inArray } from 'drizzle-orm'
import {
  candidates, clipSubtitles, clips, exportsTable, jobs, jobSteps, scenes, segments, videos,
} from '@shotprompt/db'
import type { Ctx } from '../context'
import { videoDir } from '../env'

const ACTIVE_STATUSES = ['queued', 'running']

export const videoRoutes = (ctx: Ctx) => new Elysia()
  .post('/videos', async ({ body, request }) => {
    const contentType = request.headers.get('content-type') ?? ''
    const isMultipart = contentType.includes('multipart/form-data')
    const b = body as Record<string, unknown>

    const id = crypto.randomUUID()
    mkdirSync(videoDir(id), { recursive: true })

    let uploadPath: string
    let filename: string
    let language: string
    if (isMultipart) {
      const file = b.file as File | undefined
      if (!file) return status(400, { message: 'file is required' })
      language = String(b.language ?? '')
      filename = file.name
      uploadPath = join(videoDir(id), 'upload' + extname(file.name))
      await Bun.write(uploadPath, file)
    } else {
      const path = b.path as string | undefined
      language = String(b.language ?? '')
      if (!path || !existsSync(path)) return status(400, { message: 'file not found: ' + path })
      filename = basename(path)
      uploadPath = join(videoDir(id), 'upload' + extname(path))
      await Bun.write(uploadPath, Bun.file(path))
    }

    ctx.db.insert(videos).values({ id, filename, path: uploadPath, status: 'uploaded', language, createdAt: Date.now() }).run()
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
      clipCount: ctx.db.select().from(clips).where(eq(clips.videoId, v.id)).all().length,
    }))
  })
  .get('/videos/:id', ({ params }) => {
    const video = ctx.db.select().from(videos).where(eq(videos.id, params.id)).get()
    if (!video) return status(404, { message: 'not found' })
    const job = ctx.db.select().from(jobs).where(eq(jobs.videoId, params.id)).orderBy(desc(jobs.createdAt)).get()
    const steps = job ? ctx.db.select().from(jobSteps).where(eq(jobSteps.jobId, job.id)).orderBy(jobSteps.id).all() : []
    const candidateCount = ctx.db.select().from(candidates).where(eq(candidates.videoId, params.id)).all().length
    return { video, job: job ? { ...job, steps } : null, candidateCount }
  })
  .delete('/videos/:id', ({ params }) => {
    const video = ctx.db.select().from(videos).where(eq(videos.id, params.id)).get()
    if (!video) return status(404, { message: 'not found' })

    const latestJob = ctx.db.select().from(jobs).where(eq(jobs.videoId, params.id)).orderBy(desc(jobs.createdAt)).get()
    if (latestJob && ACTIVE_STATUSES.includes(latestJob.status)) return status(409, { message: 'job active' })

    const jobIds = ctx.db.select().from(jobs).where(eq(jobs.videoId, params.id)).all().map(j => j.id)
    if (jobIds.length) ctx.db.delete(jobSteps).where(inArray(jobSteps.jobId, jobIds)).run()

    const clipIds = ctx.db.select().from(clips).where(eq(clips.videoId, params.id)).all().map(c => c.id)
    if (clipIds.length) {
      ctx.db.delete(clipSubtitles).where(inArray(clipSubtitles.clipId, clipIds)).run()
      ctx.db.delete(exportsTable).where(inArray(exportsTable.clipId, clipIds)).run()
    }

    ctx.db.delete(clips).where(eq(clips.videoId, params.id)).run()
    ctx.db.delete(candidates).where(eq(candidates.videoId, params.id)).run()
    ctx.db.delete(scenes).where(eq(scenes.videoId, params.id)).run()
    ctx.db.delete(segments).where(eq(segments.videoId, params.id)).run()
    ctx.db.delete(jobs).where(eq(jobs.videoId, params.id)).run()
    ctx.db.delete(videos).where(eq(videos.id, params.id)).run()

    rmSync(videoDir(params.id), { recursive: true, force: true })
    return { ok: true }
  })
  .post('/videos/:id/retry', ({ params }) => {
    const video = ctx.db.select().from(videos).where(eq(videos.id, params.id)).get()
    if (!video) return status(404, { message: 'not found' })

    const latestPipelineJob = ctx.db.select().from(jobs)
      .where(eq(jobs.videoId, params.id))
      .orderBy(desc(jobs.createdAt))
      .all()
      .find(j => j.type === 'pipeline')
    if (latestPipelineJob && ACTIVE_STATUSES.includes(latestPipelineJob.status)) {
      return status(409, { message: 'pipeline job already active' })
    }

    const jobId = crypto.randomUUID()
    ctx.db.insert(jobs).values({ id: jobId, videoId: params.id, type: 'pipeline', status: 'queued', createdAt: Date.now() }).run()
    ctx.pipelineQueue.enqueue(jobId)
    return { jobId }
  })
  .get('/videos/:id/thumb/:file', ({ params }) => {
    const { file } = params
    if (basename(file) !== file) return status(400, { message: 'invalid file' })
    const path = join(videoDir(params.id), 'thumbs', file)
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
