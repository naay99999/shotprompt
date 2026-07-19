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

// `model` gets interpolated straight into a filesystem path (`modelPath`) and a URL
// (`hfUrl`) below — restrict it to characters real whisper model names actually use
// (e.g. `large-v3`, `medium`, `tiny`) so a crafted value like `../../etc/passwd` can't
// escape MODELS_DIR or redirect the download to an arbitrary host.
const MODEL_NAME_PATTERN = /^[\w.-]+$/

// The models the Settings/Setup UI lets a user pick between. The active model (from
// settings, which could be something else entirely — e.g. `tiny` for local dev) is
// always folded in too, so `doctor.models` never omits the one actually configured.
const KNOWN_MODELS = ['large-v3', 'medium']

// `ffmpeg -filters` prints one line per filter: a 3-char capability-flags column, then
// the filter name, then an I/O spec (e.g. `V->V`), then a free-text description. We
// require the I/O-spec shape to anchor the match — otherwise a naive substring search
// for "ass" false-positives on filter names like `asplit`/`aselect` and on description
// words like "band-pass"/"to pass in output".
export function parseLibassSupport(filtersOutput: string): boolean {
  return filtersOutput.split('\n').some(line => {
    const m = line.match(/^\s*\S+\s+(\S+)\s+\S+->\S+/)
    return m !== null && (m[1] === 'ass' || m[1] === 'subtitles')
  })
}

async function checkLibass(): Promise<boolean> {
  if (Bun.which('ffmpeg') === null) return false
  try {
    const proc = Bun.spawn(['ffmpeg', '-filters'], { stdout: 'pipe', stderr: 'ignore' })
    const out = await new Response(proc.stdout).text()
    await proc.exited
    return parseLibassSupport(out)
  } catch {
    return false
  }
}

export const systemRoutes = (db: DB) => new Elysia()
  .get('/system/doctor', async () => {
    const model = getSetting(db, 'whisperModel', 'large-v3')
    const modelNames = [...new Set([...KNOWN_MODELS, model])]
    return {
      ffmpeg: Bun.which('ffmpeg') !== null,
      ffprobe: Bun.which('ffprobe') !== null,
      whisper: Bun.which('whisper-cli') !== null,
      // Homebrew's default ffmpeg build commonly omits libass, silently breaking the
      // "burn subtitles" export path — surfaced separately from ffmpeg/ffprobe presence
      // since a user can have a perfectly working install that still lacks this.
      libass: await checkLibass(),
      model: { name: model, downloaded: existsSync(modelPath(model)) },
      // Per-model download state, needed so the Settings page can show "ดาวน์โหลดแล้ว" /
      // download-progress for both selectable models independently of which one is
      // currently active (the `model` field above only ever reflects the active one).
      models: modelNames.map(name => ({ name, downloaded: existsSync(modelPath(name)) })),
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
    if (!MODEL_NAME_PATTERN.test(model)) {
      set.status = 400
      return { error: 'invalid model name' }
    }
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
