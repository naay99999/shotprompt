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
  it('ASS carries the selected language font and 9:16 PlayRes', () => {
    const ass = buildASS(subs, 10, 20, '9:16')
    expect(ass).toContain('Style: Default,Noto Sans Thai,64,')
    expect(ass).toContain('PlayResX: 1080')
    expect(ass).toContain('PlayResY: 1920')
    expect(ass).toContain('Dialogue: 0,0:00:02.00,0:00:04.00,Default,,0,0,0,,ลดราคา')
  })
  it('preserves non-Thai subtitle text', () => {
    const ass = buildASS([{ start: 1, end: 2, text: '你好 مرحبا नमस्ते' }], 0, 3, '9:16')
    expect(ass).toContain('Style: Default,Noto Sans Thai,64,')
    expect(ass).toContain('Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,你好 مرحبا नमस्ते')
  })
  it('selects a bundled font family for the selected subtitle language', () => {
    const japanese = buildASS(subs, 10, 20, '9:16', undefined, 'ja')
    const tibetan = buildASS(subs, 10, 20, '9:16', undefined, 'bo')
    const hebrew = buildASS(subs, 10, 20, '9:16', undefined, 'yi')

    expect(japanese).toContain('Style: Default,Noto Sans CJK JP,64,')
    expect(tibetan).toContain('Style: Default,Noto Serif Tibetan,64,')
    expect(hebrew).toContain('Style: Default,Noto Sans Hebrew Thin,64,')
  })
})
