import { expect, it } from 'bun:test';
import { buildHighlightWindows } from '../src/analysis-windows';
import { parseAnalysisOptions } from '../src/analysis-profiles';
import type { AnalysisInput } from '../src/analysis-types';
const input: AnalysisInput = { segments: [], scenes: [], duration: 120, language: 'th', options: parseAnalysisOptions(undefined) };
it('empty source returns no windows and short speech stays within source', () => {
  expect(buildHighlightWindows(input)).toEqual([]);
  const rows = buildHighlightWindows({ ...input, duration: 8, segments: [{ id: 1, start: 0, end: 8, text: 'คำอธิบายสั้น' }] });
  expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ start: 0, end: 8 }); expect(rows[0].warnings.length).toBeGreaterThan(0);
});
it('Thai without punctuation and long segments never exceed requested max after padding', () => {
  for (const row of buildHighlightWindows({ ...input, segments: [{ id: 1, start: 0, end: 100, text: 'ปัญหาคืออะไรแล้วเราจะแก้ได้อย่างไร' }] })) {
    expect(row.end - row.start).toBeLessThanOrEqual(60); expect(row.start).toBeGreaterThanOrEqual(0); expect(row.end).toBeLessThanOrEqual(120);
  }
});
it('long videos retain end coverage with bounded results and invalid input is ignored', () => {
  const segments = Array.from({ length: 3600 }, (_, id) => ({ id, start: id * 3, end: id * 3 + 2.5, text: 'อธิบาย' }));
  segments.push({ id: -1, start: NaN, end: Infinity, text: 'bad' });
  const rows = buildHighlightWindows({ ...input, duration: 10800, segments });
  expect(rows.length).toBeLessThanOrEqual(500); expect(rows.length).toBeGreaterThan(0);
  expect(rows.some(r => r.start > 10600)).toBe(true); expect(rows.every(r => Number.isFinite(r.start + r.end))).toBe(true);
});
it('scene-only windows remain candidates and do not invent transcript', () => {
  const rows = buildHighlightWindows({ ...input, scenes: [10, 50, NaN] });
  expect(rows.length).toBeGreaterThan(0); expect(rows.every(r => r.source === 'scene' && !r.segmentIds.length)).toBe(true);
});
it('can cover the tail of a single segment longer than the allowed clip length', () => {
  const rows = buildHighlightWindows({ ...input, duration: 300, segments: [{ id: 1, start: 0, end: 300, text: 'long transcript without segmentation' }] });
  expect(rows.some(row => row.end >= 290)).toBe(true);
});
