import type { Aspect } from './types'

export interface LoudnormStats { input_i: string; input_tp: string; input_lra: string; input_thresh: string; target_offset: string }

export function parseProbe(json: string) {
  const d = JSON.parse(json)
  const v = d.streams?.find((s: any) => s.codec_type === 'video')
  const a = d.streams?.find((s: any) => s.codec_type === 'audio')
  return { duration: parseFloat(d.format?.duration ?? '0'), width: v?.width ?? 0, height: v?.height ?? 0, vcodec: v?.codec_name, acodec: a?.codec_name }
}
export const needsTranscode = (p: { vcodec?: string; acodec?: string }) => !(p.vcodec === 'h264' && p.acodec === 'aac')

export const buildProbeArgs = (input: string) => ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', input]

export function buildNormalizeArgs(input: string, output: string, transcode: boolean): string[] {
  return transcode
    ? ['-i', input, '-c:v', 'libx264', '-crf', '23', '-preset', 'fast', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', output]
    : ['-i', input, '-c', 'copy', '-movflags', '+faststart', '-y', output]
}
export const buildExtractAudioArgs = (input: string, output: string) =>
  ['-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', output]
export const buildSceneArgs = (input: string) =>
  ['-i', input, '-vf', "select='gt(scene,0.3)',showinfo", '-f', 'null', '-']
export const parseSceneTimestamps = (stderr: string) =>
  [...stderr.matchAll(/pts_time:([\d.]+)/g)].map(m => parseFloat(m[1]))
export const buildThumbnailArgs = (input: string, atSeconds: number, output: string) =>
  ['-ss', String(atSeconds), '-i', input, '-vframes', '1', '-vf', 'scale=480:-2', '-y', output]

const LOUDNORM = 'I=-16:TP=-1.5:LRA=11'
export const buildLoudnormMeasureArgs = (input: string, start: number, end: number) =>
  ['-ss', String(start), '-to', String(end), '-i', input, '-af', `loudnorm=${LOUDNORM}:print_format=json`, '-f', 'null', '-']
export function parseLoudnorm(stderr: string): LoudnormStats {
  const m = stderr.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('loudnorm json not found in ffmpeg output')
  return JSON.parse(m[0])
}

function cropFilter(aspect: Aspect, cropOffset: number): string | null {
  if (aspect === '9:16') return `crop=ih*9/16:ih:(iw-ih*9/16)/2*(1+${cropOffset}):0,scale=1080:1920`
  if (aspect === '16:9') return `crop=min(iw\\,ih*16/9):min(ih\\,iw*9/16),scale=1920:1080`
  return null
}

export function buildExportArgs(opts: { input: string; start: number; end: number; aspect: Aspect; cropOffset: number; assPath?: string; fontsDir?: string; loudnorm: LoudnormStats; output: string }): string[] {
  const filters: string[] = []
  const crop = cropFilter(opts.aspect, opts.cropOffset)
  if (crop) filters.push(crop)
  if (opts.assPath) filters.push(`ass=${opts.assPath}${opts.fontsDir ? `:fontsdir=${opts.fontsDir}` : ''}`)
  const ln = opts.loudnorm
  const af = `loudnorm=${LOUDNORM}:measured_I=${ln.input_i}:measured_TP=${ln.input_tp}:measured_LRA=${ln.input_lra}:measured_thresh=${ln.input_thresh}:offset=${ln.target_offset}:linear=true`
  const args = ['-ss', String(opts.start), '-to', String(opts.end), '-i', opts.input]
  if (filters.length) args.push('-vf', filters.join(','))
  args.push('-af', af, '-c:v', 'libx264', '-crf', '23', '-preset', 'fast', '-c:a', 'aac', '-b:a', '128k', '-y', opts.output)
  return args
}
