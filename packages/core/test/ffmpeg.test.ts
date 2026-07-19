import { describe, expect, it } from 'bun:test'
import { parseProbe, needsTranscode, parseSceneTimestamps, parseLoudnorm, buildExportArgs, parseWhisperLine, buildWhisperArgs } from '../src'

it('parseProbe reads duration/resolution/codecs', () => {
  const j = JSON.stringify({ format: { duration: '120.5' }, streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 },
    { codec_type: 'audio', codec_name: 'aac' }] })
  const p = parseProbe(j)
  expect(p).toEqual({ duration: 120.5, width: 1920, height: 1080, vcodec: 'h264', acodec: 'aac' })
  expect(needsTranscode(p)).toBe(false)
  expect(needsTranscode({ ...p, vcodec: 'hevc' })).toBe(true)
})

it('parseSceneTimestamps extracts pts_time', () => {
  const stderr = 'n:0 pts:100 pts_time:4.171 … n:1 pts:200 pts_time:9.343'
  expect(parseSceneTimestamps(stderr)).toEqual([4.171, 9.343])
})

it('parseLoudnorm reads the json block from stderr', () => {
  const stderr = 'noise\n{\n"input_i" : "-23.6",\n"input_tp" : "-6.5",\n"input_lra" : "5.9",\n"input_thresh" : "-34.0",\n"target_offset" : "0.3"\n}\n'
  expect(parseLoudnorm(stderr).input_i).toBe('-23.6')
})

it('buildExportArgs: 9:16 crop honours cropOffset and burns ass', () => {
  const args = buildExportArgs({ input: 'in.mp4', start: 10, end: 20, aspect: '9:16', cropOffset: 0.5,
    assPath: 's.ass', fontsDir: 'assets/fonts',
    loudnorm: { input_i: '-23.6', input_tp: '-6.5', input_lra: '5.9', input_thresh: '-34.0', target_offset: '0.3' },
    output: 'out.mp4' })
  const vf = args[args.indexOf('-vf') + 1]
  expect(vf).toContain("crop=ih*9/16:ih:(iw-ih*9/16)/2*(1+0.5):0")
  expect(vf).toContain('scale=1080:1920')
  expect(vf).toContain("ass=s.ass:fontsdir=assets/fonts")
  const af = args[args.indexOf('-af') + 1]
  expect(af).toContain('measured_I=-23.6')
})

it('whisper args + line parse', () => {
  expect(buildWhisperArgs({ model: 'm.bin', audio: 'a.wav', language: 'th', offsetMs: 5000 }))
    .toEqual(['-m', 'm.bin', '-f', 'a.wav', '-l', 'th', '-ot', '5000'])
  expect(parseWhisperLine('[00:01:02.500 --> 00:01:04.000]  สวัสดีค่ะ'))
    .toEqual({ start: 62.5, end: 64, text: 'สวัสดีค่ะ' })
  expect(parseWhisperLine('whisper_init: loading model')).toBeNull()
})
