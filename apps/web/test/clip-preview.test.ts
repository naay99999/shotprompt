import { expect, it } from 'bun:test'
import { isTimeWithinPreviewRange, nextPreviewPosition, previewRangeForClip } from '../lib/clip-preview'

it('loops playback back to the clip start only at the selected clip boundary', () => {
  const range = { start: 12, end: 24 }
  expect(nextPreviewPosition(23.9, range)).toBeNull()
  expect(nextPreviewPosition(24, range)).toBe(12)
})

it('creates a valid bounded range from a clip', () => {
  expect(previewRangeForClip({ start: 12, end: 24 })).toEqual({ start: 12, end: 24 })
  expect(previewRangeForClip({ start: 24, end: 12 })).toBeNull()
})

it('keeps preview mode while seeking within the selected clip', () => {
  const range = { start: 12, end: 24 }
  expect(isTimeWithinPreviewRange(11.9, range)).toBe(false)
  expect(isTimeWithinPreviewRange(12, range)).toBe(true)
  expect(isTimeWithinPreviewRange(18, range)).toBe(true)
  expect(isTimeWithinPreviewRange(24, range)).toBe(true)
  expect(isTimeWithinPreviewRange(24.1, range)).toBe(false)
})
