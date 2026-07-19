import { join } from 'node:path'
import { eq, max } from 'drizzle-orm'
import { segments, videos, type DB } from '@shotprompt/db'
import { buildWhisperArgs, parseWhisperLine, type Language } from '@shotprompt/core'
import { getSetting, modelPath, videoDir } from '../env'
import { emitEvent } from '../events'
import type { JobCtx } from '../queue'
import { runCmd } from './spawn'

export function satisfied(db: DB, videoId: string): boolean { return false } // resume handled inside run; full completion tracked via prior segments + offset reaching duration is not knowable — always run, resume makes it cheap

export async function run(db: DB, videoId: string, ctx: JobCtx) {
  const v = db.select().from(videos).where(eq(videos.id, videoId)).get()!
  const last = db.select({ m: max(segments.end) }).from(segments).where(eq(segments.videoId, videoId)).get()?.m ?? 0
  if (v.duration && last >= v.duration - 5) return // effectively complete from a previous run
  const offsetMs = last > 0 ? Math.floor(last * 1000) : 0
  const model = modelPath(getSetting(db, 'whisperModel', 'large-v3'))
  let lastEmit = 0
  await runCmd('whisper-cli', buildWhisperArgs({ model, audio: join(videoDir(videoId), 'audio.wav'), language: v.language as Language, offsetMs }), ctx, {
    onStdoutLine: line => {
      const seg = parseWhisperLine(line)
      if (!seg) return
      // NOTE: verify once during implementation whether whisper.cpp prints absolute
      // timestamps when --offset-t is set; if relative, add offsetMs/1000 here.
      db.insert(segments).values({ videoId, start: seg.start, end: seg.end, text: seg.text }).run()
      if (Date.now() - lastEmit > 2000) {
        lastEmit = Date.now()
        // `text` feeds the live transcript feed in the processing screen (design)
        emitEvent('step:update', { videoId, name: 'transcribe', status: 'running', progress: v.duration ? seg.end / v.duration : 0, text: seg.text, time: seg.end })
      }
    },
  })
}
