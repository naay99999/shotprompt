import { CATEGORY_LABELS, type CandidateView, type ClipAssessmentSnapshot, type AnalysisAssessment, type Evidence, type AnalysisRunView } from '@shotprompt/core';
export function formatAnalysisScore(candidate: Pick<CandidateView, 'score' | 'assessment'>): string {
  if (candidate.score === null) return 'ยังประเมินคะแนนไม่ได้';
  return candidate.assessment ? `${Math.round(candidate.score)}/100` : `คะแนนระบบเดิม ${Math.round(candidate.score)}`;
}
export interface AnalysisDisplay { engineLabel: string; title: string; summary: string; tags: string[]; scoreLabel: string; dimensions: { key: string; label: string; value: string }[]; reasons: { text: string; evidence: Evidence[] }[]; warnings: string[]; suppressionLabel: string | null }
const aiLabels = { opening: 'การเปิดประเด็น', standalone: 'ดูแยกแล้วเข้าใจ', substance: 'สาระและจุดน่าสนใจ', closure: 'จบประเด็นครบ', relevance: 'ตรงความต้องการ' };
const oldLabels = { hook: 'การเปิดประเด็น', categoryFit: 'ตรงหมวดเดิม', completeness: 'สัญญาณความครบ', pacing: 'ความต่อเนื่องของบทพูด', goalFit: 'ตรงเป้าหมายเดิม' };
export function toAnalysisDisplay(candidate: Pick<CandidateView, 'score' | 'assessment'>): AnalysisDisplay {
  const a = candidate.assessment;
  const base = { scoreLabel: formatAnalysisScore(candidate), warnings: a?.warnings.map(w => WARNING_LABELS[w] ?? w) ?? [] };
  if (!a) return { ...base, engineLabel: 'ระบบเดิม', title: 'ช่วงที่แนะนำ', summary: '', tags: [], dimensions: [], reasons: [], suppressionLabel: null };
  if (a.schemaVersion === 2) return { ...base, engineLabel: 'AI · ประเมินจากบทถอดเสียง', title: a.title, summary: a.summary, tags: a.tags, dimensions: Object.entries(a.dimensions).map(([key, d]) => ({ key, label: aiLabels[key as keyof typeof aiLabels], value: d.value === null ? 'ไม่มีข้อมูล' : `${d.value}/5` })), reasons: a.reasons, suppressionLabel: a.suppressionReason === 'semantic' ? 'AI เห็นว่าอาจซ้ำประเด็นกับช่วงอันดับสูงกว่า' : a.suppressionReason === 'overflow' ? 'ตัวเลือกเพิ่มเติมนอกจำนวนคลิปที่ขอ' : a.suppressionReason === 'overlap' ? 'ช่วงเวลาซ้อนกับรายการอันดับสูงกว่า' : a.suppressionReason === 'text' ? 'ข้อความใกล้เคียงกับรายการอันดับสูงกว่า' : null };
  return { ...base, engineLabel: 'กฎเดิม · ภาษาไทย/อังกฤษ', title: 'ช่วงที่แนะนำจากกฎเดิม', summary: '', tags: Object.entries(a.categoryScores).filter(([, v]) => (v?.dimensions.categoryFit ?? 0) > 0).map(([key]) => CATEGORY_LABELS[key as keyof typeof CATEGORY_LABELS]), dimensions: Object.entries(a.dimensions).map(([key, value]) => ({ key, label: oldLabels[key as keyof typeof oldLabels], value: value === null ? 'ไม่มีข้อมูล' : `${Math.round(value)}/100` })), reasons: a.reasons.map(r => ({ text: SIGNAL_LABELS[r.code] ?? r.code, evidence: [r] })), suppressionLabel: a.suppressedBy ? 'ช่วงซ้ำกับรายการอันดับสูงกว่า' : null };
}
export function filterCandidates(rows: CandidateView[], filters: { tag: string | null; minScore: number | null; includeSuppressed: boolean }): CandidateView[] {
  return rows.filter(row => (filters.includeSuppressed || row.isPrimary) && (!filters.tag || toAnalysisDisplay(row).tags.includes(filters.tag)) && (filters.minScore === null || (row.assessment !== null && row.score !== null && row.score >= filters.minScore)));
}
export function analysisRunLabel(run: AnalysisRunView): string { return run.engineVersion === 'llm-v1' ? `AI · ${run.evaluatorMetadata?.snapshot.provider.model ?? 'โมเดล'} · ${run.evaluatorMetadata?.snapshot.rubricVersion ?? 'clip-content-v1'}` : 'กฎเดิม'; }
export function isAssessmentStale(snapshot: ClipAssessmentSnapshot, start: number, end: number): boolean {
  return Math.abs(snapshot.evaluatedStart - start) > 0.01 || Math.abs(snapshot.evaluatedEnd - end) > 0.01;
}
export const WARNING_LABELS: Record<string, string> = {
  'needs-context': 'ช่วงนี้อาจต้องดูบริบทก่อนหน้า', 'short-source': 'วิดีโอสั้นกว่าความยาวที่ขอ', 'starts-mid-thought': 'อาจเริ่มกลางประเด็น', 'ends-too-soon': 'อาจจบก่อนครบประเด็น',
  'scene-only': 'ช่วงจากภาพเปลี่ยน ยังไม่มีหลักฐานสำหรับคะแนนเนื้อหา', 'unsupported-language': 'ชุดเกณฑ์ภาษานี้ยังไม่รองรับ',
};
export const SIGNAL_LABELS: Record<string, string> = {
  benefit: 'มีคำกล่าวถึงประโยชน์', proof: 'มีคำกล่าวถึงการทดลองหรือหลักฐาน', offer: 'มีข้อเสนอหรือโปรโมชัน', cta: 'มีคำชวนซื้อ', question: 'มีคำถาม', opinion: 'มีคำแสดงมุมมอง', experience: 'มีคำกล่าวถึงประสบการณ์', answer: 'มีคำบอกคำตอบ', problem: 'มีคำกล่าวถึงปัญหาหรือข้อผิดพลาด', instruction: 'มีคำอธิบายวิธีทำ', example: 'มีคำยกตัวอย่าง', conclusion: 'มีคำบอกการสรุป', setup: 'มีคำเปิดเรื่อง', conflict: 'มีคำบอกเหตุการณ์พลิกผัน', change: 'มีคำบอกจุดเปลี่ยน', resolution: 'มีคำบอกบทสรุปเรื่อง', urgency: 'มีคำเร่งตัดสินใจ',
};
