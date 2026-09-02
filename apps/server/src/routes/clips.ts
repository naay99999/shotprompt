import { Elysia, status, t } from 'elysia'
import { asc, desc, eq } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import { candidates, clipSubtitles, clips, exportsTable, type DB } from '@shotprompt/db'
import { buildSRT } from '@shotprompt/core'
import type { Ctx } from '../context'
import { createClip, replaceClipSubtitles, updateClip } from '../clip-service'

export const clipRoutes = ({ db }: Ctx) => new Elysia()
  .get('/videos/:id/candidates', ({ params }) =>
    db.select().from(candidates).where(eq(candidates.videoId, params.id)).orderBy(desc(candidates.score)).all())
  .get('/videos/:id/clips', ({ params }) =>
    db.select().from(clips).where(eq(clips.videoId, params.id)).orderBy(asc(clips.createdAt)).all())
  .post('/videos/:id/clips', ({ params, body }) => {
    try { return createClip(db, params.id, body) }
    catch (e) { return status(400, { message: String(e) }) }
  }, { body: t.Object({ candidateId: t.Optional(t.String()), start: t.Optional(t.Number()), end: t.Optional(t.Number()) }) })
  .patch('/clips/:id', ({ params, body }) => {
    try { return updateClip(db, params.id, body) }
    catch (e) { return status(400, { message: String(e) }) }
  }, { body: t.Object({ start: t.Optional(t.Number()), end: t.Optional(t.Number()), cropOffset: t.Optional(t.Number()) }) })
  .delete('/clips/:id', ({ params }) => {
    for (const ex of db.select().from(exportsTable).where(eq(exportsTable.clipId, params.id)).all())
      if (ex.path) rmSync(ex.path, { force: true })
    db.delete(exportsTable).where(eq(exportsTable.clipId, params.id)).run()
    db.delete(clipSubtitles).where(eq(clipSubtitles.clipId, params.id)).run()
    db.delete(clips).where(eq(clips.id, params.id)).run()
    return { ok: true }
  })
  .get('/clips/:id/subtitles', ({ params }) =>
    db.select().from(clipSubtitles).where(eq(clipSubtitles.clipId, params.id)).orderBy(asc(clipSubtitles.start)).all())
  .put('/clips/:id/subtitles', ({ params, body }) => {
    try {
      replaceClipSubtitles(db, params.id, body.subtitles)
      return { ok: true }
    } catch (e) {
      return status(400, { message: String(e) })
    }
  }, { body: t.Object({ subtitles: t.Array(t.Object({ start: t.Number(), end: t.Number(), text: t.String() })) }) })
  .get('/clips/:id/srt', ({ params }) => {
    const clip = db.select().from(clips).where(eq(clips.id, params.id)).get()
    if (!clip) return status(404)
    const rows = db.select().from(clipSubtitles).where(eq(clipSubtitles.clipId, params.id)).all()
    return new Response(buildSRT(rows, clip.start, clip.end), {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="clip-${clip.id}.srt"` },
    })
  })
