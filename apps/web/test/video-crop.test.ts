import { expect, it } from 'bun:test'
import { cropPreviewRect } from '../lib/video-crop'

it('fits the crop frame to the contained video rather than fullscreen letterboxing', () => {
  expect(cropPreviewRect(1600, 1000, 1920, 1080, 0)).toEqual({
    left: 546.875,
    top: 50,
    width: 506.25,
    height: 900,
  })
})

it('moves the crop frame within the visible video bounds', () => {
  expect(cropPreviewRect(1600, 1000, 1920, 1080, 1)).toEqual({
    left: 1093.75,
    top: 50,
    width: 506.25,
    height: 900,
  })
})
