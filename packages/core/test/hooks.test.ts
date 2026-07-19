import { describe, expect, it } from 'bun:test'
import { scoreWindow, detectHooks, DEFAULT_HOOK_TIERS_TH, DEFAULT_HOOK_TIERS_EN } from '../src'
import type { TranscriptSegment } from '../src'

const TH = DEFAULT_HOOK_TIERS_TH
const EN = DEFAULT_HOOK_TIERS_EN

describe('DEFAULT_HOOK_TIERS_TH', () => {
  it('tier 1 contains urgency keywords', () => {
    const t1 = TH.find(t => t.tier === 1)!
    expect(t1.keywords).toContain('ด่วน')
    expect(t1.keywords).toContain('วันนี้เท่านั้น')
    expect(t1.weight).toBe(25)
  })
  it('tier 2 contains discount keywords', () => {
    const t2 = TH.find(t => t.tier === 2)!
    expect(t2.keywords).toContain('ลด')
    expect(t2.keywords).toContain('ส่งฟรี')
    expect(t2.weight).toBe(15)
  })
  it('tier 3 contains action keywords', () => {
    const t3 = TH.find(t => t.tier === 3)!
    expect(t3.keywords).toContain('CF')
    expect(t3.keywords).toContain('ซื้อเลย')
    expect(t3.weight).toBe(8)
  })
})

describe('DEFAULT_HOOK_TIERS_EN', () => {
  it('tier 1 contains urgency keywords', () => {
    const t1 = EN.find(t => t.tier === 1)!
    expect(t1.keywords).toContain('limited')
    expect(t1.keywords).toContain('last chance')
    expect(t1.weight).toBe(25)
  })
  it('tier 2 contains discount keywords', () => {
    const t2 = EN.find(t => t.tier === 2)!
    expect(t2.keywords).toContain('discount')
    expect(t2.keywords).toContain('free shipping')
    expect(t2.weight).toBe(15)
  })
  it('tier 3 contains action keywords', () => {
    const t3 = EN.find(t => t.tier === 3)!
    expect(t3.keywords).toContain('buy now')
    expect(t3.keywords).toContain('trending')
    expect(t3.weight).toBe(8)
  })
})

describe('scoreWindow', () => {
  it('returns 0 for no keywords', () => expect(scoreWindow('สวัสดีครับทุกคน', TH)).toBe(0))
  it('returns 0 for empty string', () => expect(scoreWindow('', TH)).toBe(0))
  it('single tier-1 = 25', () => expect(scoreWindow('ด่วน', TH)).toBe(25))
  it('single tier-2 = 15', () => expect(scoreWindow('ลด', TH)).toBe(15))
  it('single tier-3 = 8', () => expect(scoreWindow('CF', TH)).toBe(8))
  it('sums across tiers', () => expect(scoreWindow('ด่วน ลด CF', TH)).toBe(48))
  it('counts each keyword once', () => expect(scoreWindow('ลด ลด ลด', TH)).toBe(15))
})

describe('detectHooks', () => {
  it('empty in, empty out', () => expect(detectHooks([], undefined, TH)).toEqual([]))
  it('below threshold → empty', () =>
    expect(detectHooks([{ start: 0, end: 10, text: 'สวัสดีครับทุกคน' }], undefined, TH)).toEqual([]))
  it('one clip for a high-scoring segment', () => {
    const clips = detectHooks([{ start: 10, end: 20, text: 'ด่วน ลด โปร' }], undefined, TH)
    expect(clips).toHaveLength(1)
    expect(clips[0].score).toBeGreaterThanOrEqual(40)
  })
  it('clamps start to 0', () =>
    expect(detectHooks([{ start: 0, end: 10, text: 'ด่วน ลด โปร' }], undefined, TH)[0].start).toBe(0))
  it('hook across three short consecutive segments', () => {
    const segs: TranscriptSegment[] = [
      { start: 10, end: 12, text: 'ด่วน' },
      { start: 12, end: 14, text: 'ลด' },
      { start: 14, end: 16, text: 'โปร' },
    ]
    const clips = detectHooks(segs, undefined, TH)
    expect(clips).toHaveLength(1)
    expect(clips[0].score).toBeGreaterThanOrEqual(40)
  })
  it('two clips when far apart', () =>
    expect(
      detectHooks(
        [
          { start: 0, end: 10, text: 'ด่วน ลด โปร' },
          { start: 200, end: 210, text: 'ด่วน ลด โปร' },
        ],
        undefined,
        TH,
      ),
    ).toHaveLength(2))
  it('merges nearby windows', () =>
    expect(
      detectHooks(
        [
          { start: 0, end: 10, text: 'ด่วน ลด โปร' },
          { start: 12, end: 22, text: 'ด่วน ลด โปร' },
        ],
        undefined,
        TH,
      ),
    ).toHaveLength(1))
  it('merged clip keeps max score', () => {
    const clips = detectHooks(
      [
        { start: 0, end: 10, text: 'ลด โปร' },
        { start: 12, end: 22, text: 'ด่วน วันนี้เท่านั้น จำกัด' },
      ],
      undefined,
      TH,
    )
    expect(clips).toHaveLength(1)
    expect(clips[0].score).toBeGreaterThan(scoreWindow('ลด โปร', TH))
  })
  it('scene timestamps become candidates', () => {
    const clips = detectHooks([], [30, 90], TH)
    expect(clips).toHaveLength(2)
    clips.forEach(c => expect(c.score).toBe(35))
  })
  it('dedupes scenes closer than SCENE_MIN_INTERVAL', () =>
    expect(detectHooks([], [30, 35, 40, 90], TH)).toHaveLength(2))
  it('merges audio + nearby scene candidates', () => {
    const clips = detectHooks([{ start: 28, end: 38, text: 'ด่วน ลด โปร' }], [30], TH)
    expect(clips).toHaveLength(1)
    expect(clips[0].score).toBeGreaterThanOrEqual(40)
  })
  it('snaps end to last segment + breath pad', () =>
    expect(detectHooks([{ start: 10, end: 20, text: 'ด่วน ลด โปร' }], undefined, TH)[0].end).toBeCloseTo(21.5, 1))
  it('scene clip with no segments ends at ts+SCENE_WINDOW+BREATH_PAD', () =>
    expect(detectHooks([], [30], TH)[0].end).toBeCloseTo(61.5, 1))
  it('no merge past MAX_CLIP_DURATION', () => {
    const clips = detectHooks(
      [
        { start: 0, end: 60, text: 'ด่วน ลด โปร' },
        { start: 80, end: 90, text: 'ด่วน ลด โปร' },
      ],
      undefined,
      TH,
    )
    expect(clips).toHaveLength(2)
    clips.forEach(c => expect(c.end - c.start).toBeLessThanOrEqual(100))
  })
})
