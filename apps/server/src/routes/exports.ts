import { Elysia, status, t } from 'elysia'
import { desc, eq, inArray } from 'drizzle-orm'
import { basename, extname, join } from 'node:path'
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { clips, clipSubtitles, exportsTable, jobs, videos, type DB } from '@shotprompt/db'
import { buildASS, buildExportArgs, buildLoudnormMeasureArgs, parseLoudnorm, type Aspect, type Language } from '@shotprompt/core'
import type { Ctx } from '../context'
import type { JobRunner } from '../queue'
import { emitEvent } from '../events'
import { FONTS_DIR, videoDir } from '../env'
import { runCmd } from '../steps/spawn'

export function makeExportRunner(db: DB): JobRunner {
  return async (exportId, ctx) => {
    const exp = db.select().from(exportsTable).where(eq(exportsTable.id, exportId)).get()!
    const clip = db.select().from(clips).where(eq(clips.id, exp.clipId)).get()!
    const video = db.select().from(videos).where(eq(videos.id, clip.videoId)).get()!
    db.update(exportsTable).set({ status: 'rendering' }).where(eq(exportsTable.id, exportId)).run()
    emitEvent('export:update', { exportId, clipId: clip.id, videoId: video.id, status: 'rendering' })
    const dir = videoDir(video.id)
    mkdirSync(join(dir, 'exports'), { recursive: true })
    const out = join(dir, 'exports', `${exportId}.mp4`), tmp = out + '.tmp.mp4'
    let assPath: string | undefined
    try {
      if (exp.burnSubtitles) {
        const rows = db.select().from(clipSubtitles).where(eq(clipSubtitles.clipId, clip.id)).all()
        assPath = join(dir, 'exports', `${exportId}.ass`)
        await Bun.write(assPath, buildASS(rows, clip.start, clip.end, exp.aspect as Aspect, { x: video.width!, y: video.height! }, video.language as Language))
      }
      const { stderr } = await runCmd('ffmpeg', buildLoudnormMeasureArgs(video.path, clip.start, clip.end), ctx, { ignoreExitCode: true })
      const loudnorm = parseLoudnorm(stderr)
      await runCmd('ffmpeg', buildExportArgs({
        input: video.path, start: clip.start, end: clip.end, aspect: exp.aspect as Aspect,
        cropOffset: clip.cropOffset, assPath, fontsDir: FONTS_DIR, loudnorm, output: tmp,
      }), ctx)
      renameSync(tmp, out)
      db.update(exportsTable).set({ status: 'done', path: out }).where(eq(exportsTable.id, exportId)).run()
      emitEvent('export:update', { exportId, clipId: clip.id, videoId: video.id, status: 'done' })
    } catch (e) {
      db.update(exportsTable).set({ status: 'failed', error: String(e) }).where(eq(exportsTable.id, exportId)).run()
      emitEvent('export:update', { exportId, clipId: clip.id, videoId: video.id, status: 'failed' })
      throw e
    } finally {
      if (assPath) rmSync(assPath, { force: true })
      // Cancellation (or any other failure) can leave the partial ffmpeg output
      // behind — clean it up immediately rather than waiting for the next
      // server-restart sweep. Only present when the export never reached `renameSync`.
      if (existsSync(tmp)) rmSync(tmp, { force: true })
    }
  }
}

export const exportRoutes = (ctx: Ctx) => new Elysia()
  .get('/videos/:id/exports', ({ params }) => {
    const clipIds = ctx.db.select({ id: clips.id }).from(clips).where(eq(clips.videoId, params.id)).all().map(c => c.id)
    if (!clipIds.length) return []
    return ctx.db.select().from(exportsTable).where(inArray(exportsTable.clipId, clipIds)).orderBy(desc(exportsTable.createdAt)).all()
  })
  .post('/exports', ({ body }) => {
    const { clipIds, aspect, burnSubtitles } = body
    const rows = clipIds.map(id => ctx.db.select().from(clips).where(eq(clips.id, id)).get())
    const missing = clipIds.filter((id, i) => !rows[i])
    if (missing.length) return status(404, { message: `clip(s) not found: ${missing.join(', ')}` })

    const created: (typeof exportsTable.$inferSelect)[] = []
    for (const clip of rows as (typeof clips.$inferSelect)[]) {
      const exportId = crypto.randomUUID()
      ctx.db.insert(exportsTable).values({
        id: exportId, clipId: clip.id, aspect, burnSubtitles, status: 'queued', createdAt: Date.now(),
      }).run()
      ctx.db.insert(jobs).values({ id: exportId, videoId: clip.videoId, type: 'export', status: 'queued', createdAt: Date.now() }).run()
      ctx.exportQueue.enqueue(exportId)
      created.push(ctx.db.select().from(exportsTable).where(eq(exportsTable.id, exportId)).get()!)
    }
    return created
  }, {
    body: t.Object({
      clipIds: t.Array(t.String()),
      aspect: t.Union([t.Literal('9:16'), t.Literal('16:9'), t.Literal('original')]),
      burnSubtitles: t.Boolean(),
    }),
  })
  .get('/exports/:id/download', ({ params }) => {
    const exp = ctx.db.select().from(exportsTable).where(eq(exportsTable.id, params.id)).get()
    if (!exp) return status(404, { message: 'not found' })
    if (exp.status !== 'done' || !exp.path) return status(409, { message: 'export not ready' })

    const clip = ctx.db.select().from(clips).where(eq(clips.id, exp.clipId)).get()
    const video = clip ? ctx.db.select().from(videos).where(eq(videos.id, clip.videoId)).get() : undefined
    const baseName = video ? basename(video.filename, extname(video.filename)) : 'export'
    const filename = `${baseName}-${clip?.start ?? 0}s.mp4`

    return new Response(Bun.file(exp.path), {
      headers: { 'content-disposition': `attachment; filename="${filename}"` },
    })
  })
  .delete('/exports/:id', ({ params }) => {
    const exp = ctx.db.select().from(exportsTable).where(eq(exportsTable.id, params.id)).get()
    if (!exp) return status(404, { message: 'not found' })
    if (exp.path) rmSync(exp.path, { force: true })
    ctx.db.delete(exportsTable).where(eq(exportsTable.id, params.id)).run()
    return { ok: true }
  })
