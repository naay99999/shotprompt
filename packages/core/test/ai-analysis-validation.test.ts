import { expect, it } from 'bun:test';
import { parseDiscoveryResponse, parseEvaluationResponse, materializeAiResults } from '../src/ai-analysis-validation';
import { parseAiAnalysisOptions } from '../src/analysis-contracts';
import { buildAiChunks } from '../src/ai-analysis-chunks';
import { DEFAULT_AI_BUDGETS } from '../src/ai-analysis-types';
export const aiSource = { duration: 80, language: 'th', scenes: [], segments: [1, 2, 3, 4].map(id => ({ id, start: (id - 1) * 20, end: id * 20, text: `ข้อความจริง ${id}` })) };
export const aiProposal = { proposalId: 'p', startSegmentId: 1, endSegmentId: 2, provisionalTitle: 'หัวข้อ', evidenceSegmentIds: [1] };
export const accepted = () => ({ proposalId: 'p', startSegmentId: 1, endSegmentId: 2, title: 'หัวข้อ', summary: 'สรุปจากข้อความ', tags: ['ความรู้'], dimensions: { opening: { value: 5, evidenceSegmentIds: [1] }, standalone: { value: 4, evidenceSegmentIds: [1] }, substance: { value: 3, evidenceSegmentIds: [2] }, closure: { value: 2, evidenceSegmentIds: [2] }, relevance: { value: 1, evidenceSegmentIds: [1] } }, reasons: [{ text: 'มีตัวอย่าง', evidenceSegmentIds: [2] }], warnings: [] });
const options = parseAiAnalysisOptions(undefined), batch = { proposals: [aiProposal], segments: aiSource.segments };
it('rejects invented IDs, missing batch results and ungrounded dimensions', () => {
  for (const result of [{ ...accepted(), startSegmentId: 99 }, { ...accepted(), reasons: [{ text: 'ไม่ตรงช่วง', evidenceSegmentIds: [4] }] }, { ...accepted(), dimensions: { ...accepted().dimensions, opening: { value: 5, evidenceSegmentIds: [] } } }, { ...accepted(), dimensions: { ...accepted().dimensions, closure: { value: NaN, evidenceSegmentIds: [2] } } }]) expect(() => parseEvaluationResponse({ results: [result] }, batch, aiSource, options)).toThrow('invalid-output');
  expect(() => parseEvaluationResponse({ results: [] }, batch, aiSource, options)).toThrow();
});
it('materializes quotes from original text and calculates total independently', () => {
  const parsed = parseEvaluationResponse({ results: [{ ...accepted(), totalScore: 99 }] }, batch, aiSource, options);
  const result = materializeAiResults(aiSource, options, parsed)[0];
  expect(result.score).toBe(65);
  expect(result.start).toBe(0); expect(result.end).toBe(40.5);
  expect(result.assessment.reasons[0]).toMatchObject({ evidence: [{ text: 'ข้อความจริง 2', segmentId: 2 }] });
});
it('allows an analyzed empty discovery but preserves model inability status', () => {
  const chunk = buildAiChunks(aiSource, DEFAULT_AI_BUDGETS)[0];
  expect(parseDiscoveryResponse({ status: 'analyzed', proposals: [], requestedBoundaryContext: [] }, chunk).proposals).toHaveLength(0);
  expect(parseDiscoveryResponse({ status: 'unsupported-language', proposals: [], requestedBoundaryContext: [] }, chunk).status).toBe('unsupported-language');
  expect(() => parseDiscoveryResponse({ status: 'analyzed', proposals: [{ startSegmentId: 1, endSegmentId: 99, provisionalTitle: 'เรื่อง', evidenceSegmentIds: [1] }], requestedBoundaryContext: [] }, chunk)).toThrow();
});
it('rejects a range needing a segment cut to meet max duration', () => {
  const long = { ...aiSource, duration: 200, segments: [{ id: 1, start: 0, end: 200, text: 'ยาว' }] };
  expect(() => parseEvaluationResponse({ results: [{ ...accepted(), endSegmentId: 1, dimensions: Object.fromEntries(Object.entries(accepted().dimensions).map(([k, d]) => [k, { ...d, evidenceSegmentIds: [1] }])), reasons: [] }] }, { proposals: [{ ...aiProposal, endSegmentId: 1 }], segments: long.segments }, long, options)).toThrow();
});
it('rejects semantic duplicate targets not supplied in the evaluation batch', () => {
  expect(() => parseEvaluationResponse({ results: [{ ...accepted(), duplicateOf: 'unseen-proposal', duplicateEvidenceSegmentIds: [1] }] }, batch, aiSource, options)).toThrow('invalid-output');
});
it('accepts all available speech in a short source and recommends its full duration', () => {
  const short = { duration: 10, language: 'th', scenes: [], segments: [{ id: 1, start: .5, end: 9.5, text: 'ตัวอย่างและสรุป' }] };
  const row = { ...accepted(), endSegmentId: 1, dimensions: Object.fromEntries(Object.entries(accepted().dimensions).map(([k, d]) => [k, { ...d, evidenceSegmentIds: [1] }])), reasons: [] };
  const parsed = parseEvaluationResponse({ results: [row] }, { proposals: [{ ...aiProposal, endSegmentId: 1 }], segments: short.segments }, short, options);
  const result = materializeAiResults(short, options, parsed)[0];
  expect(result.start).toBe(0); expect(result.end).toBe(10); expect(result.warnings).toContain('short-source');
});
it('rejects a semantic duplicate of a rejected proposal inside the repair validation', () => {
  const pair = { proposals: [aiProposal, { ...aiProposal, proposalId: 'q' }], segments: aiSource.segments };
  expect(() => parseEvaluationResponse({ results: [{ ...accepted(), duplicateOf: 'q', duplicateEvidenceSegmentIds: [1] }, { proposalId: 'q', rejected: true, reason: 'ไม่ครบประเด็น', evidenceSegmentIds: [1] }] }, pair, aiSource, options)).toThrow('invalid-output');
});
