import { Elysia, t } from 'elysia'
import { createWriteStream, existsSync, readdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { DB } from '@shotprompt/db'
import { videos } from '@shotprompt/db'
import { DATA_DIR, getSetting, modelPath, setSetting, videoDir } from '../env'
import { emitEvent, sseResponse } from '../events'

const dirSize = (dir: string): number => {
  if (!existsSync(dir)) return 0
  let total = 0
  for (const f of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (f.isFile()) total += statSync(join(f.parentPath, f.name)).size
  }
  return total
}

export async function downloadModel(
  url: string, dest: string,
  onProgress: (received: number, total: number) => void,
): Promise<void> {
  const tmp = dest + '.tmp.bin'
  let received = existsSync(tmp) ? statSync(tmp).size : 0
  const res = await fetch(url, { headers: received > 0 ? { range: `bytes=${received}-` } : {} })
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`)
  if (received > 0 && res.status !== 206) received = 0 // server ignored Range → restart
  const total = received + Number(res.headers.get('content-length') ?? 0)
  const out = createWriteStream(tmp, { flags: received > 0 ? 'a' : 'w' })
  let lastEmit = 0
  for await (const chunk of res.body) {
    out.write(chunk)
    received += chunk.length
    if (Date.now() - lastEmit > 1000) { lastEmit = Date.now(); onProgress(received, total) }
  }
  await new Promise<void>((resolve, reject) => out.end((e: unknown) => e ? reject(e) : resolve()))
  renameSync(tmp, dest)
  onProgress(received, total)
}

const hfUrl = (m: string) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${m}.bin`
const downloading = new Set<string>()

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
  .post('/system/model/download', ({ set, body }) => {
    const model = body.model
    if (existsSync(modelPath(model)) || downloading.has(model)) {
      set.status = 409
      return { error: 'already downloading or already downloaded' }
    }
    downloading.add(model)
    downloadModel(
      hfUrl(model),
      modelPath(model),
      (received, total) => emitEvent('model:download', { model, received, total, done: false }),
    )
      .then(() => emitEvent('model:download', { model, done: true }))
      .catch(e => emitEvent('model:download', { model, error: String(e), done: true }))
      .finally(() => downloading.delete(model))
    return { started: true }
  }, { body: t.Object({ model: t.String() }) })
