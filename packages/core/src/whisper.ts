import type { Language, TranscriptSegment } from './types'

export function buildWhisperArgs(opts: { model: string; audio: string; language: Language; offsetMs?: number }): string[] {
  const args = ['-m', opts.model, '-f', opts.audio, '-l', opts.language]
  if (opts.offsetMs && opts.offsetMs > 0) args.push('-ot', String(opts.offsetMs))
  args.push('-pp')
  return args
}

const LINE = /^\[(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> (\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s+(.*)$/
export function parseWhisperLine(line: string): TranscriptSegment | null {
  const m = line.match(LINE)
  if (!m) return null
  const t = (h: string, mi: string, s: string, ms: string) => +h * 3600 + +mi * 60 + +s + +ms / 1000
  const text = m[9].trim()
  if (!text) return null
  return { start: t(m[1], m[2], m[3], m[4]), end: t(m[5], m[6], m[7], m[8]), text }
}

export function parseWhisperProgress(line: string): number | null {
  const m = line.match(/progress\s*=\s*(\d{1,3})%/)
  if (!m) return null
  const progress = Number(m[1])
  return progress >= 0 && progress <= 100 ? progress / 100 : null
}
