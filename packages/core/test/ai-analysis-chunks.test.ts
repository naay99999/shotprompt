import { expect, it } from 'bun:test';
import { buildAiChunks, buildBoundaryChunk, buildEvaluationBatches, serializedCodepoints } from '../src/ai-analysis-chunks';
import { DEFAULT_AI_BUDGETS } from '../src/ai-analysis-types';
import { parseAiAnalysisOptions } from '../src/analysis-contracts';
const source = { duration: 300, language: 'th', scenes: [], segments: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, start: i * 10, end: i * 10 + 10, text: 'เรื่องที่สำคัญ'.repeat(5) })) };
it('covers every core record exactly once including the tail and preserves context records', () => {
  const chunks = buildAiChunks(source, { ...DEFAULT_AI_BUDGETS, coreCodepoints: 900 });
  expect(chunks.flatMap(c => c.coreSegmentIds)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  expect(chunks[0].segments.some(s => !chunks[0].coreSegmentIds.includes(s.id))).toBe(true);
  expect(chunks.flatMap(c => c.segments).every(s => s.text === source.segments[0].text)).toBe(true);
});
it('rejects oversized records, excess chunk counts and malformed source IDs', () => {
  expect(() => buildAiChunks({ ...source, segments: [{ id: 1, start: 0, end: 10, text: 'x'.repeat(9000) }] }, DEFAULT_AI_BUDGETS)).toThrow('input-too-large');
  expect(() => buildAiChunks(source, { ...DEFAULT_AI_BUDGETS, coreCodepoints: 200, maxChunks: 2 })).toThrow('input-too-large');
  expect(() => buildAiChunks({ ...source, segments: [source.segments[0], source.segments[0]] }, DEFAULT_AI_BUDGETS)).toThrow('invalid-source');
});
it('keeps both sides of a boundary and bounds complete evaluation payloads', () => {
  const chunks = buildAiChunks(source, { ...DEFAULT_AI_BUDGETS, coreCodepoints: 900 });
  const boundary = buildBoundaryChunk(chunks[0], chunks[1], source, DEFAULT_AI_BUDGETS);
  expect(boundary.segments.some(s => chunks[0].coreSegmentIds.includes(s.id))).toBe(true);
  expect(boundary.segments.some(s => chunks[1].coreSegmentIds.includes(s.id))).toBe(true);
  const proposals = [1, 4, 7, 10, 13].map(id => ({ proposalId: `p${id}`, startSegmentId: id, endSegmentId: id + 1, evidenceSegmentIds: [id], provisionalTitle: 'เรื่อง' }));
  const batches = buildEvaluationBatches(proposals, source, parseAiAnalysisOptions(undefined), DEFAULT_AI_BUDGETS);
  expect(batches.flatMap(b => b.proposals)).toHaveLength(5);
  expect(batches.every(b => b.proposals.length <= 4 && serializedCodepoints(b) <= 16000)).toBe(true);
});
it('bounds the actual evaluation JSON including long instructions and duration fields', () => {
  const options = parseAiAnalysisOptions({ instruction: 'ก'.repeat(500) });
  const dense = { duration: 60, language: 'th', scenes: [], segments: [1, 2, 3].map(id => ({ id, start: (id - 1) * 20, end: id * 20, text: 'ก'.repeat(300) })) };
  const proposals = [{ proposalId: 'p', startSegmentId: 1, endSegmentId: 1, provisionalTitle: 'หัวข้อ', evidenceSegmentIds: [1] }];
  const batches = buildEvaluationBatches(proposals, dense, options, { ...DEFAULT_AI_BUDGETS, evaluationCodepoints: 1200 });
  expect(batches).toHaveLength(1);
  for (const batch of batches) expect(serializedCodepoints({ instruction: options.instruction, minDuration: options.minDuration, maxDuration: options.maxDuration, proposals: batch.proposals, source: batch.segments })).toBeLessThanOrEqual(1200);
  expect(batches[0].segments.some(s => s.id === 1)).toBe(true);
});
