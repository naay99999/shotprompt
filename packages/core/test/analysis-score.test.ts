import { expect, it } from 'bun:test';
import { scoreHighlight } from '../src/analysis-score';
import { collectSignals } from '../src/analysis-signals';
import { parseAnalysisOptions } from '../src/analysis-profiles';
import type { AnalysisInput, HighlightWindow, Category } from '../src/analysis-types';
const window: HighlightWindow = { key: '0:20', start: 0, end: 20, segmentIds: [1], source: 'speech', warnings: [] };
const make = (text: string, language = 'th'): AnalysisInput => ({ duration: 20, language, scenes: [], options: parseAnalysisOptions(undefined), segments: [{ id: 1, start: 0, end: 20, text }] });
const examples: [Category, string, string][] = [
  ['sales', 'th', 'ช่วยประหยัด ทดสอบแล้ว ส่งฟรี ซื้อเลย'], ['sales', 'en', 'benefit proven discount buy now'],
  ['podcast', 'th', 'คุณคิดว่า ในมุมผม จากประสบการณ์ คำตอบคือ'], ['podcast', 'en', 'what do you think in my opinion my experience the answer is'],
  ['education', 'th', 'ข้อผิดพลาด วิธีทำ ยกตัวอย่าง สรุปคือ'], ['education', 'en', 'common mistake step by step for example in summary'],
  ['story', 'th', 'ตอนแรก แต่แล้ว จุดเปลี่ยน สุดท้าย'], ['story', 'en', 'at first but then turning point in the end'],
];
for (const [category, language, text] of examples) it(`recognizes ${category} ${language} with actual segment evidence`, () => {
  const r = scoreHighlight(make(text, language), window);
  expect(r.assessment.primaryCategory).toBe(category); expect(r.score).toBeGreaterThan(0); expect(r.score).toBeLessThanOrEqual(100);
  expect(r.assessment.reasons.length).toBeGreaterThan(0);
  for (const e of r.assessment.reasons) { expect(e.segmentId).toBe(1); expect(text.includes(e.text)).toBe(true); }
});
it('does not score unsupported language or scene-only content', () => {
  expect(scoreHighlight(make('日本語', 'ja'), window).score).toBeNull();
  expect(scoreHighlight(make(''), { ...window, source: 'scene', segmentIds: [] }).score).toBeNull();
});
it('avoids substring false positives and repeated keyword inflation', () => {
  expect(collectSignals(make('coffee', 'en'), window).some(e => e.code === 'offer')).toBe(false);
  const once = scoreHighlight(make('ส่งฟรี ซื้อเลย'), window);
  expect(scoreHighlight(make('ส่งฟรี ซื้อเลย '.repeat(30)), window).score).toBe(once.score);
  expect(collectSignals(make('ส่งฟรี'), window).filter(e => e.code === 'offer')).toHaveLength(1);
});
it('source quotes remain original after normalization', () => {
  const input = make('BUY NOW discount', 'en');
  for (const e of collectSignals(input, window)) expect(input.segments[0].text.includes(e.text)).toBe(true);
});
it('does not attribute words outside a partially included transcript segment', () => {
  const input = make('buy now discount benefit proven', 'en'); input.segments[0].end = 90; input.duration = 90;
  const result = scoreHighlight(input, window);
  expect(result.assessment.reasons).toEqual([]);
  expect(result.assessment.primaryCategory).toBeNull();
});
it('repeating a longest phrase in later segments does not introduce its shorter substring as a new signal', () => {
  const input = make('how to', 'en'); input.segments = [{ id: 1, start: 0, end: 3, text: 'how to' }, { id: 2, start: 4, end: 7, text: 'how to' }];
  const evidence = collectSignals(input, { ...window, segmentIds: [1, 2] });
  expect(evidence.map(e => e.code)).toEqual(['instruction']);
});
it('repeated long phrases within one segment do not expose overlapping short phrases', () => {
  expect(collectSignals(make('how to and how to', 'en'), window).map(e => e.code)).toEqual(['instruction']);
});
it('a topic mentioned only in a partial segment cannot increase goal fit', () => {
  const input = make('buy now discount benefit proven', 'en'); input.segments[0].end = 90; input.duration = 90;
  const matched = scoreHighlight({ ...input, options: { ...input.options, query: 'discount' } }, window);
  const missing = scoreHighlight({ ...input, options: { ...input.options, query: 'zzzz' } }, window);
  expect(matched.score).toBe(missing.score);
});
