export function getImportedVideoId(result: unknown): string | null {
  if (typeof result === 'string') {
    try { result = JSON.parse(result); } catch { return null; }
  }
  if (!result || typeof result !== 'object' || !('video' in result)) return null;
  const video = result.video;
  if (!video || typeof video !== 'object' || !('id' in video)) return null;
  return typeof video.id === 'string' && /^[a-zA-Z0-9_-]+$/.test(video.id) ? video.id : null;
}
