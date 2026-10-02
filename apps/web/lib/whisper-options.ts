export type WhisperModel = 'large-v3' | 'medium'

export type WhisperOptions = {
  model: { name: string; downloaded: boolean }
  selectableModels: readonly WhisperModel[]
  models: { name: string; downloaded: boolean }[]
  languages: readonly { code: string; name: string }[]
}

export type WhisperModelOption = { name: WhisperModel; downloaded: boolean }

export function getAvailableWhisperModels(options: WhisperOptions): WhisperModelOption[] {
  return options.selectableModels.map(name => ({
    name,
    downloaded: options.models.find(model => model.name === name)?.downloaded ?? false,
  }))
}

export function getPreferredWhisperModel(
  options: WhisperOptions,
  savedModel: string | null | undefined,
): WhisperModel | null {
  const available = getAvailableWhisperModels(options).filter(model => model.downloaded)
  return available.find(model => model.name === savedModel)?.name
    ?? available.find(model => model.name === options.model.name)?.name
    ?? available[0]?.name
    ?? null
}
