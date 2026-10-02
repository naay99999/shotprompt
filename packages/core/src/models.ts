export const WHISPER_MODELS = ['large-v3', 'medium'] as const

export type WhisperModel = (typeof WHISPER_MODELS)[number]

const WHISPER_MODEL_NAMES = new Set<string>(WHISPER_MODELS)

export function isWhisperModel(value: unknown): value is WhisperModel {
  return typeof value === 'string' && WHISPER_MODEL_NAMES.has(value)
}
