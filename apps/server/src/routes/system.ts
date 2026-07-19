import { Elysia, t } from 'elysia'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { DB } from '@shotprompt/db'
import { videos } from '@shotprompt/db'
import { DATA_DIR, getSetting, modelPath, setSetting, videoDir } from '../env'
import { sseResponse } from '../events'

const dirSize = (dir: string): number => {
  if (!existsSync(dir)) return 0
  let total = 0
  for (const f of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (f.isFile()) total += statSync(join(f.parentPath, f.name)).size
  }
  return total
}

export const systemRoutes = (db: DB) => new Elysia()
  .get('/system/doctor', () => {
    const model = getSetting(db, 'whisperModel', 'large-v3')
    return {
      ffmpeg: Bun.which('ffmpeg') !== null,
      ffprobe: Bun.which('ffprobe') !== null,
      whisper: Bun.which('whisper-cli') !== null,
      model: { name: model, downloaded: existsSync(modelPath(model)) },
      acceleration: process.platform === 'darwin' && process.arch === 'arm64' ? 'metal (homebrew default)' : 'cpu',
    }
  })
  .get('/system/disk-usage', () => ({
    total: dirSize(DATA_DIR),
    videos: db.select().from(videos).all().map(v => ({ id: v.id, filename: v.filename, bytes: dirSize(videoDir(v.id)) })),
  }))
  .get('/settings', () => ({ whisperModel: getSetting(db, 'whisperModel', 'large-v3') }))
  .put('/settings', ({ body }) => {
    if (body.whisperModel) setSetting(db, 'whisperModel', body.whisperModel)
    return { ok: true }
  }, { body: t.Object({ whisperModel: t.Optional(t.String()) }) })
  .get('/events', () => sseResponse())
