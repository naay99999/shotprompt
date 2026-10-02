export interface TranscriptSegment {
  start: number
  end: number
  text: string
}

export interface ScoredClip {
  start: number
  end: number
  score: number
}

export interface KeywordTier {
  tier: 1 | 2 | 3
  weight: number
  keywords: string[]
}

export type Language = import('./languages').WhisperLanguage
export type Aspect = '9:16' | '16:9' | 'original'
