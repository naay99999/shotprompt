import { describe, expect, it } from 'bun:test'
import { getPreferredWhisperModel, getAvailableWhisperModels, type WhisperOptions } from '../lib/whisper-options'

const options: WhisperOptions = {
  model: { name: 'large-v3', downloaded: true },
  selectableModels: ['large-v3', 'medium'],
  models: [
    { name: 'large-v3', downloaded: true },
    { name: 'medium', downloaded: false },
  ],
  languages: [],
}

describe('transcription model options', () => {
  it('shows each supported model with its download state', () => {
    expect(getAvailableWhisperModels(options)).toEqual([
      { name: 'large-v3', downloaded: true },
      { name: 'medium', downloaded: false },
    ])
  })

  it('prefers a saved model when it is downloaded', () => {
    const bothDownloaded = {
      ...options,
      models: options.models.map(model => ({ ...model, downloaded: true })),
    }
    expect(getPreferredWhisperModel(bothDownloaded, 'medium')).toBe('medium')
  })

  it('falls back to a downloaded Settings model when the saved one is unavailable', () => {
    expect(getPreferredWhisperModel(options, 'medium')).toBe('large-v3')
  })

  it('does not offer a model choice when neither model is downloaded', () => {
    const unavailable = { ...options, models: options.models.map(model => ({ ...model, downloaded: false })) }
    expect(getAvailableWhisperModels(unavailable).some(model => model.downloaded)).toBe(false)
    expect(getPreferredWhisperModel(unavailable, null)).toBeNull()
  })
})
