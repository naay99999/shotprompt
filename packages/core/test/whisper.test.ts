import { describe, expect, it } from 'bun:test'
import { buildWhisperArgs, parseWhisperLine, parseWhisperProgress } from '../src'

it('whisper args + line parse', () => {
  expect(buildWhisperArgs({ model: 'm.bin', audio: 'a.wav', language: 'th', offsetMs: 5000 }))
    .toEqual(['-m', 'm.bin', '-f', 'a.wav', '-l', 'th', '-ot', '5000', '-pp'])
  expect(parseWhisperLine('[00:01:02.500 --> 00:01:04.000]  สวัสดีค่ะ'))
    .toEqual({ start: 62.5, end: 64, text: 'สวัสดีค่ะ' })
  expect(parseWhisperLine('whisper_init: loading model')).toBeNull()
})

it('requests and parses Whisper progress from stderr', () => {
  expect(buildWhisperArgs({ model: 'm.bin', audio: 'a.wav', language: 'th' }))
    .toEqual(['-m', 'm.bin', '-f', 'a.wav', '-l', 'th', '-pp'])
  expect(buildWhisperArgs({ model: 'm.bin', audio: 'a.wav', language: 'ja' }))
    .toEqual(['-m', 'm.bin', '-f', 'a.wav', '-l', 'ja', '-pp'])
  expect(parseWhisperProgress('whisper_print_progress_callback: progress =  45%')).toBe(0.45)
  expect(parseWhisperProgress('whisper_init: loading model')).toBeNull()
})
