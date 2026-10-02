export type CropPreviewRect = { left: number; top: number; width: number; height: number }

export function cropPreviewRect(
  containerWidth: number,
  containerHeight: number,
  videoWidth: number,
  videoHeight: number,
  cropOffset: number,
): CropPreviewRect | null {
  if (![containerWidth, containerHeight, videoWidth, videoHeight].every(value => Number.isFinite(value) && value > 0)) {
    return null
  }

  const videoAspect = videoWidth / videoHeight
  const containerAspect = containerWidth / containerHeight
  const contentWidth = containerAspect > videoAspect ? containerHeight * videoAspect : containerWidth
  const contentHeight = containerAspect > videoAspect ? containerHeight : containerWidth / videoAspect
  const contentLeft = (containerWidth - contentWidth) / 2
  const contentTop = (containerHeight - contentHeight) / 2
  const frameWidth = Math.min(contentWidth, contentHeight * (9 / 16))
  const maxShift = Math.max(0, (contentWidth - frameWidth) / 2)
  const offset = Number.isFinite(cropOffset) ? Math.max(-1, Math.min(1, cropOffset)) : 0
  const centerX = contentLeft + contentWidth / 2 + offset * maxShift

  return {
    left: centerX - frameWidth / 2,
    top: contentTop,
    width: frameWidth,
    height: contentHeight,
  }
}
