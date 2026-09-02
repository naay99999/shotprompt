export type PreviewRange = { start: number; end: number }

export function previewRangeForClip(clip: PreviewRange): PreviewRange | null {
  return Number.isFinite(clip.start) && Number.isFinite(clip.end) && clip.start < clip.end ? clip : null
}

export function nextPreviewPosition(currentTime: number, range: PreviewRange): number | null {
  return currentTime >= range.end ? range.start : null
}
