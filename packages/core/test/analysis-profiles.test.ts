import { expect, it } from 'bun:test';
import { parseAnalysisOptions, DEFAULT_ANALYSIS_OPTIONS } from '../src/analysis-profiles';
it('defaults omitted options and rejects malformed selections and ranges', () => {
  expect(parseAnalysisOptions(undefined)).toEqual({ categories: ['sales', 'podcast', 'education', 'story'], goal: 'balanced', minDuration: 15, maxDuration: 60, query: '' });
  for (const patch of [{ categories: [] }, { categories: ['sales', 'sales'] }, { categories: ['bad'] }, { maxDuration: 181 }, { minDuration: 4 }, { minDuration: 61 }, { minDuration: NaN }, { maxDuration: Infinity }, { query: 'x'.repeat(501) }, { goal: 'unknown' }]) {
    expect(() => parseAnalysisOptions({ ...DEFAULT_ANALYSIS_OPTIONS, ...patch })).toThrow();
  }
  expect(() => parseAnalysisOptions(null)).toThrow();
  expect(parseAnalysisOptions({ query: '  ของฟรี  ' }).query).toBe('ของฟรี');
});
