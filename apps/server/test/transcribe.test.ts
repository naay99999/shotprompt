import { describe, expect, it } from 'bun:test'
import { resolveWhisperModel } from '../src/steps/transcribe'

describe('transcription model selection', () => {
  it('uses the per-video model when one is saved', () => {
    expect(resolveWhisperModel({ whisperModel: 'medium' }, 'large-v3')).toBe('medium')
  })

  it('falls back to the Settings model for existing videos without a saved model', () => {
    expect(resolveWhisperModel({ whisperModel: null }, 'medium')).toBe('medium')
  })
})
