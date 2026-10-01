import { describe, expect, it } from 'bun:test'
import { isSystemReady } from '../lib/system-readiness'

const readyStatus = {
  ffmpeg: true,
  ffprobe: true,
  whisper: true,
  libx264: true,
  model: { downloaded: true },
}

describe('isSystemReady', () => {
  it('returns true when every required capability and the model are ready', () => {
    expect(isSystemReady(readyStatus)).toBe(true)
  })

  it.each(['ffmpeg', 'ffprobe', 'whisper', 'libx264'] as const)('requires %s to be working', capability => {
    expect(isSystemReady({ ...readyStatus, [capability]: false })).toBe(false)
  })

  it('requires the selected model to be downloaded', () => {
    expect(isSystemReady({ ...readyStatus, model: { downloaded: false } })).toBe(false)
  })

  it('does not require optional libass support', () => {
    const statusWithOptionalLibass = { ...readyStatus, libass: false }
    expect(isSystemReady(statusWithOptionalLibass)).toBe(true)
  })
})
