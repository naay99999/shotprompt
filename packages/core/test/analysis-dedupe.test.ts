import { expect, it } from 'bun:test';
import { rankHighlights } from '../src/analysis-dedupe';
import { analyzeHighlights } from '../src/analyze-highlights';
import { scoreHighlight } from '../src/analysis-score';
import { parseAnalysisOptions } from '../src/analysis-profiles';
import type { AnalysisInput } from '../src/analysis-types';
const input: AnalysisInput = { segments: [], scenes: [], duration: 2000, language: 'en', options: parseAnalysisOptions(undefined) };
const row = (start: number, score: number | null = 50) => ({ ...scoreHighlight(input, { key: String(start), start, end: start + 10, segmentIds: [], source: 'scene', warnings: [] }), score });
it('overlap boundary suppresses weaker candidate with reference to winner', () => {
  const rows = rankHighlights(input, [row(0, 60), row(3, 50), row(20, 40)]);
  expect(rows.find(r => r.start === 3)?.assessment).toMatchObject({ suppressedBy: '0', suppressionReason: 'overlap' });
  expect(rows.filter(r => r.isPrimary)).toHaveLength(2);
});
it('empty text is not considered duplicate and keeps overflow accessible', () => {
  const rows = rankHighlights(input, Array.from({ length: 31 }, (_, i) => row(i * 20)));
  expect(rows).toHaveLength(31); expect(rows.filter(r => r.isPrimary)).toHaveLength(30);
  expect(rows.every(r => r.assessment.suppressedBy === null)).toBe(true);
});
it('unscored scenes sort by time and evaluator stays bounded', () => {
  expect(rankHighlights(input, [row(30, null), row(0, null)]).map(r => r.start)).toEqual([0, 30]);
  const rows = analyzeHighlights({ ...input, scenes: Array.from({ length: 1000 }, (_, i) => i * 2) });
  expect(rows.length).toBeLessThanOrEqual(500); expect(rows.filter(r => r.isPrimary).length).toBeLessThanOrEqual(30);
});
it('repeated text at disjoint times is suppressed', () => {
  const source = { ...input, segments: [{ id: 1, start: 0, end: 10, text: 'the same repeated sentence about a useful topic' }, { id: 2, start: 30, end: 40, text: 'the same repeated sentence about a useful topic' }] };
  const rows = rankHighlights(source, [{ ...row(0), segmentIds: [1] }, { ...row(30), segmentIds: [2] }]);
  expect(rows[1].assessment.suppressionReason).toBe('text');
});
it('preserves Thai marks when comparing distinct topics', () => {
  const source = { ...input, language: 'th', segments: [{ id: 1, start: 0, end: 10, text: 'ฉันกินข้าว' }, { id: 2, start: 30, end: 40, text: 'ฉันกั้นข่าว' }] };
  const rows = rankHighlights(source, [{ ...row(0), segmentIds: [1] }, { ...row(30), segmentIds: [2] }]);
  expect(rows[1].assessment.suppressedBy).toBeNull(); expect(rows.filter(r => r.isPrimary)).toHaveLength(2);
});
it('suppresses text at exactly 0.8 Jaccard but not below it', () => {
  const source = { ...input, segments: [{ id: 1, start: 0, end: 10, text: 'a b c d e' }, { id: 2, start: 30, end: 40, text: 'a b c d e f' }, { id: 3, start: 60, end: 70, text: 'a b c d e f g' }] };
  const rows = rankHighlights(source, [{ ...row(0, 60), segmentIds: [1] }, { ...row(30), segmentIds: [2] }, { ...row(60), segmentIds: [3] }]);
  expect(rows[1].assessment.suppressionReason).toBe('text'); expect(rows[2].assessment.suppressedBy).toBeNull();
});
