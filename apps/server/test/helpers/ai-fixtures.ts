import { AI_DIMENSIONS } from '@shotprompt/core';
import type { ModelRequest, ModelResponse } from '../../src/ai/provider-client';
export function fixtureModelResponse(request: ModelRequest): ModelResponse {
  const data = JSON.parse(request.messages[1].content);
  const discovery = request.messages[0].content.startsWith('DISCOVERY');
  const source = data.source as { id: number; start: number; end: number; text: string }[];
  const value = discovery ? { status: 'analyzed', proposals: source.length ? [{ startSegmentId: source[0].id, endSegmentId: source[Math.min(1, source.length - 1)].id, provisionalTitle: 'ข้อคิดจากคลิป', evidenceSegmentIds: [source[0].id] }].filter(p => {
    const first = source.find(s => s.id === p.startSegmentId)!, last = source.find(s => s.id === p.endSegmentId)!;
    return (first.start + last.end) / 2 >= data.coreStart && (first.start + last.end) / 2 <= data.coreEnd;
  }) : [], requestedBoundaryContext: [] } : { results: data.proposals.map((p: any) => ({ proposalId: p.proposalId, startSegmentId: p.startSegmentId, endSegmentId: p.endSegmentId, title: 'ข้อคิดจากคลิป', summary: 'อธิบายประเด็นพร้อมตัวอย่าง', tags: ['ข้อคิด'], dimensions: Object.fromEntries(AI_DIMENSIONS.map(d => [d, { value: 4, evidenceSegmentIds: [p.startSegmentId] }])), reasons: [{ text: 'เป็นประเด็นที่นำไปใช้ได้', evidenceSegmentIds: [p.startSegmentId] }], warnings: [], duplicateOf: null, duplicateEvidenceSegmentIds: [] })) };
  return { value, reportedModel: 'fixture-model', usage: { inputTokens: 100, outputTokens: 30 } };
}
export const fixtureAiSource = { duration: 80, language: 'th', scenes: [], segments: [1, 2, 3, 4].map(id => ({ id, start: (id - 1) * 20, end: id * 20, text: `บทพูดตัวอย่าง ${id}` })) };
