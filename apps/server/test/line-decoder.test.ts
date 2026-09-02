import { expect, it } from 'bun:test'
import { LineDecoder } from '../src/steps/line-decoder'

it('preserves Thai text when a UTF-8 code point is split between chunks', () => {
  const decoder = new LineDecoder()
  const bytes = new TextEncoder().encode('[00:00:00.000 --> 00:00:01.000] สวัสดี\n')
  const split = bytes.indexOf(0xe0) + 1

  expect(decoder.push(bytes.slice(0, split))).toEqual([])
  expect(decoder.push(bytes.slice(split))).toEqual(['[00:00:00.000 --> 00:00:01.000] สวัสดี'])
  expect(decoder.finish()).toEqual([])
})
