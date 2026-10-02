import { describe, expect, it } from 'bun:test'
import { isWhisperModel, WHISPER_MODELS } from '../src'

describe('Whisper model choices', () => {
  it('exposes the multilingual models supported by the transcription UI', () => {
    expect(WHISPER_MODELS).toEqual(['large-v3', 'medium'])
    expect(isWhisperModel('large-v3')).toBe(true)
    expect(isWhisperModel('medium')).toBe(true)
    expect(isWhisperModel('tiny')).toBe(false)
  })
})
