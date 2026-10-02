import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { segments, videos, type DB } from '@shotprompt/db'
import { buildWhisperArgs, parseWhisperLine, parseWhisperProgress, type Language } from '@shotprompt/core'
import { getSetting, modelPath, videoDir } from '../env'
import { emitEvent } from '../events'
import type { JobCtx } from '../queue'
import { runCmd } from './spawn'

export function satisfied(_db: DB, _videoId: string): boolean { return false }

export function resolveWhisperModel(video: { whisperModel: string | null }, defaultModel: string): string {
  return video.whisperModel ?? defaultModel
}

export async function run(db: DB, videoId: string, ctx: JobCtx) {
  const v = db.select().from(videos).where(eq(videos.id, videoId)).get()!
  const modelName = resolveWhisperModel(v, getSetting(db, 'whisperModel', 'large-v3'))
  const model = modelPath(modelName)
  let lastEmit = 0
  let progress = 0
  await runCmd('whisper-cli', buildWhisperArgs({ model, audio: join(videoDir(videoId), 'audio.wav'), language: v.language as Language }), ctx, {
    onStderrLine: line => {
      const parsed = parseWhisperProgress(line)
      if (parsed == null || parsed <= progress) return
      progress = parsed
      emitEvent('step:update', { videoId, name: 'transcribe', status: 'running', progress })
    },
    onStdoutLine: line => {
      const seg = parseWhisperLine(line)
      if (!seg) return
      db.insert(segments).values({ videoId, start: seg.start, end: seg.end, text: seg.text }).run()
      if (Date.now() - lastEmit > 2000) {
        lastEmit = Date.now()
        // `text` feeds the live transcript feed in the processing screen (design)
        emitEvent('step:update', { videoId, name: 'transcribe', status: 'running', progress, text: seg.text, time: seg.end })
      }
    },
  })
}
