import { expect, it } from 'bun:test';
import { evaluateAiHighlights } from '../src/ai/evaluator';
import { createEvaluatorSnapshot, parseProviderConfig } from '../src/ai/provider-settings';
import { parseAiAnalysisOptions } from '@shotprompt/core';
import { fixtureAiSource, fixtureModelResponse } from './helpers/ai-fixtures';
const snapshot = () => createEvaluatorSnapshot(parseProviderConfig({ model: 'test' }));
it('discovers without keyword gating and returns grounded weighted results and usage', async () => {
  const progress: string[] = [];
  const output = await evaluateAiHighlights({ ...fixtureAiSource, options: parseAiAnalysisOptions({ instruction: 'ความผิดพลาดที่คนเริ่มต้นควรเลี่ยง' }) }, { signal: new AbortController().signal, snapshot: snapshot(), onProgress: p => progress.push(p.stage) }, { complete: async request => fixtureModelResponse(request) });
  expect(output.results[0].score).toBe(80); expect(output.results[0].isPrimary).toBe(true);
  expect(output.metadata?.requestCount).toBe(2); expect(output.metadata?.usage.inputTokens).toBe(200);
  expect(progress).toContain('discovery'); expect(progress).toContain('evaluation');
});
it('repairs invalid output once and never publishes a partial result', async () => {
  let requests = 0;
  await expect(evaluateAiHighlights({ ...fixtureAiSource, options: parseAiAnalysisOptions(undefined) }, { signal: new AbortController().signal, snapshot: snapshot(), onProgress: () => {} }, { complete: async () => { requests++; return { value: {}, reportedModel: null, usage: { inputTokens: null, outputTokens: null } }; } })).rejects.toThrow('invalid-output');
  expect(requests).toBe(2);
});
it('stops on a late chunk failure and enforces request budgets including repairs', async () => {
  const small = snapshot(); small.budgets.coreCodepoints = 80; small.budgets.contextCodepoints = 2;
  let count = 0;
  await expect(evaluateAiHighlights({ ...fixtureAiSource, options: parseAiAnalysisOptions(undefined) }, { signal: new AbortController().signal, snapshot: small, onProgress: () => {} }, { complete: async request => { count++; if (count >= 2) throw new Error('late failure'); return fixtureModelResponse(request); } })).rejects.toThrow();
  expect(count).toBe(2);
  const limited = snapshot(); limited.budgets.maxRequests = 1;
  await expect(evaluateAiHighlights({ ...fixtureAiSource, options: parseAiAnalysisOptions(undefined) }, { signal: new AbortController().signal, snapshot: limited, onProgress: () => {} }, { complete: async request => fixtureModelResponse(request) })).rejects.toThrow('request-budget-exceeded');
});
it('does not send scene-only source to a model and honors cancellation', async () => {
  let count = 0; const client = { complete: async (request: any) => { count++; return fixtureModelResponse(request); } };
  const output = await evaluateAiHighlights({ ...fixtureAiSource, segments: [], scenes: [0, 20, 40], options: parseAiAnalysisOptions(undefined) }, { signal: new AbortController().signal, snapshot: snapshot(), onProgress: () => {} }, client);
  expect(count).toBe(0); expect(output.results.length).toBeGreaterThan(0); expect(output.results[0].score).toBeNull();
  const controller = new AbortController(); controller.abort();
  await expect(evaluateAiHighlights({ ...fixtureAiSource, options: parseAiAnalysisOptions(undefined) }, { signal: controller.signal, snapshot: snapshot(), onProgress: () => {} }, client)).rejects.toThrow();
  expect(count).toBe(0);
});
it('expands each requested adjacent boundary only once and distinguishes unsupported language', async () => {
  const small = snapshot(); small.budgets.coreCodepoints = 80;
  let boundaryCount = 0;
  const output = await evaluateAiHighlights({ ...fixtureAiSource, options: parseAiAnalysisOptions(undefined) }, { signal: new AbortController().signal, snapshot: small, onProgress: () => {} }, { complete: async request => {
    if (request.messages[0].content.startsWith('DISCOVERY')) {
      const data = JSON.parse(request.messages[1].content);
      if (data.coreSegmentIds.length > 2) boundaryCount++;
      return { value: { status: 'analyzed', proposals: [], requestedBoundaryContext: data.coreSegmentIds.length > 2 ? [] : ['before', 'after'] }, reportedModel: null, usage: { inputTokens: null, outputTokens: null } };
    }
    return fixtureModelResponse(request);
  } });
  expect(output.results).toHaveLength(0); expect(boundaryCount).toBe(3);
  await expect(evaluateAiHighlights({ ...fixtureAiSource, options: parseAiAnalysisOptions(undefined) }, { signal: new AbortController().signal, snapshot: snapshot(), onProgress: () => {} }, { complete: async () => ({ value: { status: 'unsupported-language', proposals: [], requestedBoundaryContext: [] }, reportedModel: null, usage: { inputTokens: null, outputTokens: null } }) })).rejects.toThrow('unsupported-language');
});
it('fails when bounded boundary expansion still needs unavailable context', async () => {
  const small = snapshot(); small.budgets.coreCodepoints = 80;
  await expect(evaluateAiHighlights({ ...fixtureAiSource, options: parseAiAnalysisOptions(undefined) }, { signal: new AbortController().signal, snapshot: small, onProgress: () => {} }, { complete: async () => ({ value: { status: 'analyzed', proposals: [], requestedBoundaryContext: ['after'] }, reportedModel: null, usage: { inputTokens: null, outputTokens: null } }) })).rejects.toThrow('input-too-large');
});
