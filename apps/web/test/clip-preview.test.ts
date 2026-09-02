import { expect, it } from 'bun:test'
import { nextPreviewPosition, previewRangeForClip } from '../lib/clip-preview'

it('loops playback back to the clip start only at the selected clip boundary', () => {
  const range = { start: 12, end: 24 }
  expect(nextPreviewPosition(23.9, range)).toBeNull()
  expect(nextPreviewPosition(24, range)).toBe(12)
})

it('creates a valid bounded range from a clip', () => {
  expect(previewRangeForClip({ start: 12, end: 24 })).toEqual({ start: 12, end: 24 })
  expect(previewRangeForClip({ start: 24, end: 12 })).toBeNull()
})
