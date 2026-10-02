import { expect, it } from 'bun:test';
import { parseAiAnalysisOptions, parseStoredAnalysisOptions, legacyOptionsToAi } from '../src/analysis-contracts';
import { computeAiScore } from '../src/ai-analysis-score';
it('defaults AI options without categories and enforces bounds', () => {
  expect(parseAiAnalysisOptions(undefined)).toEqual({ schemaVersion: 2, minDuration: 15, maxDuration: 60, instruction: '', maxClips: 10 });
  for (const value of [{ maxClips: 0 }, { maxClips: 31 }, { instruction: 'ก'.repeat(501) }, { minDuration: Infinity }, { minDuration: 61, maxDuration: 60 }, { schemaVersion: 3 }]) expect(() => parseAiAnalysisOptions(value)).toThrow();
});
it('reads legacy options and explicitly converts query to an AI instruction', () => {
  const old = parseStoredAnalysisOptions({ categories: ['sales'], goal: 'sell', minDuration: 20, maxDuration: 45, query: 'มือใหม่' });
  expect(old).toMatchObject({ categories: ['sales'], query: 'มือใหม่' });
  expect(legacyOptionsToAi(old as any)).toEqual({ schemaVersion: 2, minDuration: 20, maxDuration: 45, instruction: 'มือใหม่', maxClips: 10 });
  expect(() => parseStoredAnalysisOptions({ schemaVersion: 9 })).toThrow();
});
it('computes weighted editorial scores from bounded dimensions', () => {
  expect(computeAiScore({ opening: 5, standalone: 5, substance: 5, closure: 5, relevance: 5 })).toBe(100);
  expect(computeAiScore({ opening: 3, standalone: 3, substance: 3, closure: 3, relevance: 3 })).toBe(60);
  expect(computeAiScore({ opening: 5, standalone: 4, substance: 3, closure: 2, relevance: 1 })).toBe(65);
  expect(() => computeAiScore({ opening: NaN, standalone: 1, substance: 1, closure: 1, relevance: 1 })).toThrow();
});
