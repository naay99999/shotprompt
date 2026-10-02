import { expect, it } from 'bun:test';
import { checkScoringProvider } from '../src/ai/provider-check';
import type { ModelRequest, ProviderClient } from '../src/ai/provider-client';

const accepted = {
  proposalId: 'probe-1', startSegmentId: 1, endSegmentId: 2, title: 'ตัวอย่างสังเคราะห์', summary: 'สรุปจากข้อความตัวอย่าง', tags: [],
  dimensions: Object.fromEntries(['opening', 'standalone', 'substance', 'closure', 'relevance'].map(name => [name, { value: 4, evidenceSegmentIds: [1] }])),
  reasons: [], warnings: [], duplicateOf: null, duplicateEvidenceSegmentIds: [],
};
function fixture(value: unknown, seen: ModelRequest[]): ProviderClient { return { complete: async request => { seen.push(request); return { value, reportedModel: null, usage: { inputTokens: null, outputTokens: null } }; } }; }

it('probes the scoring schema with synthetic segments and requires five evidence-backed dimensions', async () => {
  const seen: ModelRequest[] = [];
  expect(await checkScoringProvider({} as never, fixture({ results: [accepted] }, seen), new AbortController().signal)).toEqual({ status: 'ready' });
  expect(seen).toHaveLength(1); expect(seen[0].maxOutputTokens).toBe(1024);
  expect(JSON.stringify(seen[0].messages)).toContain('[synthetic segment 1]');
  expect(JSON.stringify(seen[0].messages)).not.toContain('subtitle from a real video');
});

it('rejects connected models that do not satisfy the evaluation response contract', async () => {
  const seen: ModelRequest[] = [];
  await expect(checkScoringProvider({} as never, fixture({ results: [{ ...accepted, dimensions: { opening: { value: 4, evidenceSegmentIds: [] } } }] }, seen), new AbortController().signal)).rejects.toThrow();
});
