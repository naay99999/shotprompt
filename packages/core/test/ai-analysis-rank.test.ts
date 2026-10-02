import { expect, it } from 'bun:test';
import { rankAiResults } from '../src/ai-analysis-rank';
import { materializeAiResults } from '../src/ai-analysis-validation';
import { parseAiAnalysisOptions } from '../src/analysis-contracts';
import { accepted, aiSource } from './ai-analysis-validation.test';
it('retains suppressed ranges and gives the strongest semantic representative priority', () => {
  const options = parseAiAnalysisOptions({ maxClips: 1 });
  const a = materializeAiResults(aiSource, options, [accepted()])[0];
  const b = { ...a, key: 'b', start: 40, end: 80, segmentIds: [3, 4], score: 90 };
  const rows = rankAiResults(aiSource, options, [a, b], [{ proposalId: 'p', duplicateOf: 'b', evidenceSegmentIds: [1] }, { proposalId: 'b', duplicateOf: 'p', evidenceSegmentIds: [3] }]);
  expect(rows).toHaveLength(2); expect(rows[0]).toMatchObject({ key: 'b', score: 90, isPrimary: true });
  expect(rows[1].assessment).toMatchObject({ suppressedBy: 'b', suppressionReason: 'semantic' });
  expect(() => rankAiResults(aiSource, options, [a], [{ proposalId: 'p', duplicateOf: 'missing', evidenceSegmentIds: [1] }])).toThrow();
});
it('keeps overflow distinguishable from overlap', () => {
  const options = parseAiAnalysisOptions({ maxClips: 1 });
  const a = materializeAiResults(aiSource, options, [accepted()])[0];
  const b = { ...a, key: 'b', start: 41, end: 80, segmentIds: [3, 4], score: 30 };
  expect(rankAiResults(aiSource, options, [a, b], [])[1].assessment.suppressionReason).toBe('overflow');
});
