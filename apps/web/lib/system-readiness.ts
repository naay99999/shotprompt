export type SystemReadinessStatus = {
  ffmpeg: boolean
  ffprobe: boolean
  whisper: boolean
  libx264: boolean
  model: { downloaded: boolean }
}

export function isSystemReady(status: SystemReadinessStatus): boolean {
  return status.ffmpeg && status.ffprobe && status.whisper && status.libx264 && status.model.downloaded
}
