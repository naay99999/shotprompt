import type { KeywordTier, Language, ScoredClip, TranscriptSegment } from './types'

export const SILENCE_GAP = 3.0
export const SCENE_WINDOW = 30
export const SCORE_THRESHOLD = 40
export const WINDOW_PAD = 5
export const BREATH_PAD = 1.5
export const MERGE_GAP = 15
export const MAX_CLIP_DURATION = 90
export const SCENE_BASE_SCORE = 35
export const SCENE_MIN_INTERVAL = 15

export function scoreWindow(text: string, tiers: KeywordTier[], language: Language = 'th'): number {
  const normalised = language === 'en' ? text.toLowerCase() : text
  let score = 0
  for (const { weight, keywords } of tiers) {
    for (const kw of keywords) {
      if (normalised.includes(kw)) {
        score += weight
      }
    }
  }
  return score
}

export function detectHooks(
  segments: TranscriptSegment[],
  sceneTimestamps: number[] | undefined,
  tiers: KeywordTier[],
  language: Language = 'th',
): ScoredClip[] {
  if (segments.length === 0 && !sceneTimestamps?.length) {
    return []
  }

  // Phase 1: activity walk
  const used = new Set<number>()
  const candidates: ScoredClip[] = []
  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue
    const anchorScore = scoreWindow(segments[i].text, tiers, language)
    if (anchorScore === 0) continue
    let clipEnd = segments[i].end
    let total = anchorScore
    used.add(i)
    for (let j = i + 1; j < segments.length; j++) {
      if (segments[j].start - clipEnd > SILENCE_GAP) break
      if (segments[j].end - segments[i].start > MAX_CLIP_DURATION) break
      clipEnd = segments[j].end
      total += scoreWindow(segments[j].text, tiers, language)
      used.add(j)
    }
    if (total >= SCORE_THRESHOLD) {
      candidates.push({ start: segments[i].start, end: clipEnd, score: total })
    }
  }

  // Phase 2: scene coverage
  if (sceneTimestamps?.length) {
    let lastKept = -Infinity
    for (const ts of sceneTimestamps.slice().sort((a, b) => a - b)) {
      if (ts - lastKept >= SCENE_MIN_INTERVAL) {
        candidates.push({ start: ts, end: ts + SCENE_WINDOW, score: SCENE_BASE_SCORE })
        lastKept = ts
      }
    }
  }
  if (candidates.length === 0) {
    return []
  }

  // Phase 3: merge
  candidates.sort((a, b) => a.start - b.start)
  const merged: ScoredClip[] = []
  let current = { ...candidates[0] }
  for (let i = 1; i < candidates.length; i++) {
    const next = candidates[i]
    if (next.start - current.end < MERGE_GAP && next.end - current.start <= MAX_CLIP_DURATION) {
      current.end = Math.max(current.end, next.end)
      current.score = Math.max(current.score, next.score)
    } else {
      merged.push(current)
      current = { ...next }
    }
  }
  merged.push(current)

  // Phase 4: pad
  return merged.map(c => ({
    start: Math.max(0, c.start - WINDOW_PAD),
    end: c.end + BREATH_PAD,
    score: c.score,
  }))
}
