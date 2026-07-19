import type { Aspect, TranscriptSegment } from './types'

export function toASSTime(seconds: number): string {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60), cs = Math.round((seconds % 1) * 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}
export function toSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60), ms = Math.round((seconds % 1) * 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

export function clampToClip(subs: TranscriptSegment[], clipStart: number, clipEnd: number): TranscriptSegment[] {
  return subs
    .filter(s => s.end > clipStart && s.start < clipEnd)
    .map(s => ({
      start: Math.max(s.start, clipStart) - clipStart,
      end: Math.min(s.end, clipEnd) - clipStart,
      text: s.text,
    }))
}

export function buildSRT(subs: TranscriptSegment[], clipStart: number, clipEnd: number): string {
  return clampToClip(subs, clipStart, clipEnd)
    .map((s, i) => `${i + 1}\n${toSRTTime(s.start)} --> ${toSRTTime(s.end)}\n${s.text}`)
    .join('\n\n')
}

const PLAY_RES: Record<string, { x: number; y: number }> = { '9:16': { x: 1080, y: 1920 }, '16:9': { x: 1920, y: 1080 } }

export function buildASS(
  subs: TranscriptSegment[], clipStart: number, clipEnd: number,
  aspect: Aspect, playRes?: { x: number; y: number },
): string {
  const res = PLAY_RES[aspect] ?? playRes
  if (!res) throw new Error('playRes required for original aspect')
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${res.x}
PlayResY: ${res.y}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, Bold, Outline, Shadow, Alignment, MarginV
Style: Default,Noto Sans Thai,64,&H00FFFFFF,&H00000000,-1,3,0,2,220

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`
  const events = clampToClip(subs, clipStart, clipEnd)
    .map(s => `Dialogue: 0,${toASSTime(s.start)},${toASSTime(s.end)},Default,,0,0,0,,${s.text}`)
    .join('\n')
  return header + events
}
