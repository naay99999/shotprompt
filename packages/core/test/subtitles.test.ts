import { describe, expect, it } from 'bun:test'
import { toASSTime, toSRTTime, clampToClip, buildSRT, buildASS } from '../src'

describe('time formats (parity with old repo)', () => {
  it('ASS: 0 → 0:00:00.00', () => expect(toASSTime(0)).toBe('0:00:00.00'))
  it('ASS: 3661.25 → 1:01:01.25', () => expect(toASSTime(3661.25)).toBe('1:01:01.25'))
  it('SRT: 3661.25 → 01:01:01,250', () => expect(toSRTTime(3661.25)).toBe('01:01:01,250'))
})

describe('clampToClip (spec trim rules)', () => {
  const subs = [
    { start: 5, end: 9, text: 'before' },     // fully outside → dropped
    { start: 9, end: 12, text: 'straddles' }, // overlaps start → clamped to 10
    { start: 12, end: 18, text: 'inside' },
    { start: 19, end: 25, text: 'tail' },     // overlaps end → clamped to 20
  ]
  it('filters overlap, clamps, shifts relative', () => {
    expect(clampToClip(subs, 10, 20)).toEqual([
      { start: 0, end: 2, text: 'straddles' },
      { start: 2, end: 8, text: 'inside' },
      { start: 9, end: 10, text: 'tail' },
    ])
  })
})

describe('buildSRT / buildASS', () => {
  const subs = [{ start: 12, end: 14, text: 'ลดราคา' }]
  it('SRT is relative and numbered', () => {
    expect(buildSRT(subs, 10, 20)).toBe('1\n00:00:02,000 --> 00:00:04,000\nลดราคา')
  })
  it('ASS carries Noto Sans Thai style and 9:16 PlayRes', () => {
    const ass = buildASS(subs, 10, 20, '9:16')
    expect(ass).toContain('Noto Sans Thai')
    expect(ass).toContain('PlayResX: 1080')
    expect(ass).toContain('PlayResY: 1920')
    expect(ass).toContain('Dialogue: 0,0:00:02.00,0:00:04.00,Default,,0,0,0,,ลดราคา')
  })
})
