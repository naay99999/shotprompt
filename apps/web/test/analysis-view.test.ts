import { expect, it } from 'bun:test';
import { formatAnalysisScore, filterCandidates, isAssessmentStale, toAnalysisDisplay } from '../lib/analysis-view';
import type { CandidateView, ClipAssessmentSnapshot } from '@shotprompt/core';
it('distinguishes legacy and absent scores without converting null into zero', () => {
  expect(formatAnalysisScore({ score: 148, assessment: null })).toBe('คะแนนระบบเดิม 148');
  expect(formatAnalysisScore({ score: null, assessment: null })).toBe('ยังประเมินคะแนนไม่ได้');
});
it('retains unscored rows unless minimum score is explicitly requested and detects stale trim', () => {
  const row: CandidateView = { id: 'x', videoId: 'v', runId: null, start: 0, end: 10, score: null, thumbnailPath: null, assessment: null, feedback: null, rank: null, isPrimary: true };
  expect(filterCandidates([row], { tag: null, minScore: null, includeSuppressed: false })).toHaveLength(1);
  expect(filterCandidates([row], { tag: null, minScore: 0, includeSuppressed: false })).toHaveLength(0);
  const snapshot = { evaluatedStart: 0, evaluatedEnd: 10 } as ClipAssessmentSnapshot;
  expect(isAssessmentStale(snapshot, 0, 10)).toBe(false); expect(isAssessmentStale(snapshot, 1, 10)).toBe(true);
});

it('normalizes AI explanations and semantic suppression while preserving original evidence', () => {
  const evidence = { code: 'opening', segmentId: 1, start: 2, end: 10, text: 'คำพูดต้นฉบับ' };
  const candidate = { id: 'ai', videoId: 'v', runId: 'r', start: 2, end: 22, score: 80, thumbnailPath: null, feedback: null, rank: 0, isPrimary: false, assessment: { schemaVersion: 2, engine: 'llm-v1', title: 'สิ่งที่ควรระวัง', summary: 'อธิบายข้อผิดพลาดพร้อมตัวอย่าง', tags: ['มือใหม่'], dimensions: { opening: { value: 4, evidence: [evidence] }, standalone: { value: 4, evidence: [evidence] }, substance: { value: 4, evidence: [evidence] }, closure: { value: 4, evidence: [evidence] }, relevance: { value: 4, evidence: [evidence] } }, reasons: [{ text: 'เปิดประเด็นชัด', evidence: [evidence] }], warnings: [], suppressedBy: 'winner', suppressionReason: 'semantic' } } as CandidateView;
  const view = toAnalysisDisplay(candidate);
  expect(view.title).toBe('สิ่งที่ควรระวัง'); expect(view.dimensions).toHaveLength(5);
  expect(view.reasons[0].evidence[0]).toEqual(evidence); expect(view.suppressionLabel).toContain('AI');
  expect(filterCandidates([candidate], { tag: 'มือใหม่', minScore: 75, includeSuppressed: true })).toHaveLength(1);
  expect(filterCandidates([candidate], { tag: 'ไม่ตรง', minScore: null, includeSuppressed: true })).toHaveLength(0);
  candidate.assessment!.suppressedBy = null;
  (candidate.assessment as any).suppressionReason = 'overflow';
  expect(toAnalysisDisplay(candidate).suppressionLabel).toContain('เพิ่มเติม');
});
