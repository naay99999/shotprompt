'use client';
import { useState } from 'react';
import Link from 'next/link';
import { type CandidateView } from '@shotprompt/core';
import { api, API_BASE } from '@/lib/api';
import { fmtTime } from '@/lib/format';
import { SCORE_HELP } from '@/lib/ui-copy';
import { checkResponse } from '@/lib/ui-error';
import { formatAnalysisScore, toAnalysisDisplay, analysisRunLabel } from '@/lib/analysis-view';
import type { useAnalysis } from '@/lib/use-analysis';
import { ErrorNotice, Help } from './ui-feedback';
import { AnalysisControls } from './analysis-controls';
import { AnalysisStatus } from './analysis-status';
import { ScoreDetails } from './score-details';
import { CandidateFeedback } from './candidate-feedback';
export type Candidate = CandidateView;
export type ClipRef = { id: string; candidateId: string | null };
export type CandidateFilters = { tag: string | null; minScore: number | null; includeSuppressed: boolean };
export function CandidatePanel({ videoId, candidates, clips, onSeek, onAccepted, analysis, filters, onFilters }: {
  videoId: string; candidates: Candidate[]; clips: ClipRef[]; onSeek: (time: number) => void; onAccepted: () => void;
  analysis: ReturnType<typeof useAnalysis>; filters: CandidateFilters; onFilters: (filters: CandidateFilters) => void;
}) {
  const [accepting, setAccepting] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<unknown>(null), [notice, setNotice] = useState('');
  const accepted = new Set(clips.map(clip => clip.candidateId));
  const running = analysis.latest?.status === 'running' || analysis.latest?.status === 'queued';
  const scoring = analysis.candidates.some(c => c.assessment && c.score !== null);
  const selected = analysis.history.find(run => run.id === analysis.selectedRunId);
  const tags = [...new Set(analysis.candidates.flatMap(c => toAnalysisDisplay(c).tags))];
  const displayedRun = selected ?? analysis.active;
  return <section aria-label="ช่วงที่แนะนำ" className="w-full min-w-0 space-y-4 rounded-2xl border border-line3 bg-surface p-4 lg:w-[360px]">
    <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">ช่วงที่แนะนำ ({candidates.length})</h2><Help label="คะแนนหมายถึงอะไร?">{SCORE_HELP}</Help></div>
    {analysis.providerConfigured === false && <p className="text-[13px] text-muted">ตั้งค่า endpoint และโมเดลก่อนวิเคราะห์ <Link href="/settings" className="text-accent underline">ตั้งค่า AI →</Link></p>}
    {displayedRun && <p className="break-words text-[12px] text-muted">{analysisRunLabel(displayedRun)}</p>}
    <details className="rounded-lg border border-line3 p-3"><summary className="cursor-pointer text-[14px] font-semibold">ตั้งค่าการคัดช่วง / ประเมินใหม่</summary><form className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); void analysis.reanalyze(); }}>
      <AnalysisControls value={analysis.draftOptions} onChange={analysis.setDraftOptions} disabled={analysis.submitting} />
      <button type="submit" disabled={analysis.submitting || running || analysis.providerConfigured === false} className="w-full rounded-lg bg-accent px-3 py-2 font-semibold text-bg disabled:opacity-50">{analysis.submitting ? 'กำลังส่ง…' : 'ประเมินช่วงใหม่'}</button>
      <p className="text-[12px] text-muted">ใช้บทถอดเสียงเดิม คลิปที่เลือกไว้ยังอยู่</p>
    </form></details>
    <AnalysisStatus latest={analysis.latest} busy={analysis.submitting} onCancel={() => void analysis.cancel()} />
    <ErrorNotice error={analysis.error} onRetry={() => void analysis.refresh()} /><ErrorNotice error={analysis.actionError} />
    {analysis.loading && <p role="status" className="text-[12px] text-muted">กำลังโหลดช่วงแนะนำ…</p>}
    {!!analysis.history.length && <div className="space-y-2"><label className="flex flex-col gap-1 text-[12px] text-muted">รอบการวิเคราะห์<select value={analysis.selectedRunId ?? ''} onChange={event => analysis.selectRun(event.target.value || null)} className="w-full min-w-0 rounded border border-line3 bg-bg p-2 text-ink"><option value="">ผลที่ใช้งานล่าสุด</option>{analysis.history.filter(run => run.status === 'done').map(run => <option key={run.id} value={run.id}>{new Date(run.createdAt).toLocaleString('th-TH')} · {analysisRunLabel(run)}</option>)}</select></label>{selected && <button type="button" onClick={() => analysis.restoreOptions(selected.options)} className="text-[12px] text-accent underline">{selected.engineVersion === 'llm-v1' ? 'นำการตั้งค่ารอบนี้มาใช้' : 'นำหัวข้อและความยาวมาใช้กับ AI (ไม่ใช้หมวด/น้ำหนักเดิม)'}</button>}</div>}
    <div className="grid grid-cols-2 gap-2 text-[12px]">
      <label>หัวข้อ<select className="mt-1 w-full rounded border border-line3 bg-bg p-2" value={filters.tag ?? ''} onChange={event => onFilters({ ...filters, tag: event.target.value || null })}><option value="">ทุกหัวข้อ</option>{tags.map(tag => <option key={tag} value={tag}>{tag}</option>)}</select></label>
      <label>คะแนนขั้นต่ำ<select disabled={!scoring} className="mt-1 w-full rounded border border-line3 bg-bg p-2 disabled:opacity-50" value={scoring ? filters.minScore ?? '' : ''} onChange={event => onFilters({ ...filters, minScore: event.target.value === '' ? null : Number(event.target.value) })}><option value="">ทั้งหมด</option>{[25, 50, 75].map(n => <option key={n} value={n}>{n}/100</option>)}</select></label>
      <label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={filters.includeSuppressed} onChange={event => onFilters({ ...filters, includeSuppressed: event.target.checked })} />แสดงช่วงซ้ำและตัวเลือกเพิ่มเติม</label>
    </div>
    <ErrorNotice error={error} /><p role="status" className="text-[12px] text-ok">{notice}</p>
    {!candidates.length && !analysis.loading && <p className="text-[14px] text-muted">ไม่มีช่วงที่ตรงกับตัวกรอง ลองเปลี่ยนการตั้งค่า หรือเลือกเวลาเริ่มและจบจากแถบเวลา</p>}
    <ul className="space-y-3">{candidates.map((candidate, index) => <li key={candidate.id} className="space-y-3 rounded-xl border border-line3 p-3">
      <button type="button" onClick={() => onSeek(candidate.start)} className="flex w-full items-center gap-3 rounded-lg text-left" aria-label={`ดูช่วงที่ ${index + 1} เริ่ม ${fmtTime(candidate.start)}`}>
        <img src={`${API_BASE}/videos/${videoId}/thumb/${candidate.id}.jpg`} alt="" className="h-12 w-20 flex-none rounded bg-line2 object-cover" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} />
        <span className="min-w-0 text-[14px]"><span className="block break-words font-semibold">{toAnalysisDisplay(candidate).title}</span><span className="block">{fmtTime(candidate.start)} – {fmtTime(candidate.end)}</span><span className="block text-[12px] text-muted">{Math.round(candidate.end - candidate.start)} วินาที</span><span className="block font-semibold text-accent">{formatAnalysisScore(candidate)}</span></span>
      </button>
      {!candidate.isPrimary && <p className="text-[12px] text-muted">{toAnalysisDisplay(candidate).suppressionLabel ?? 'ตัวเลือกเพิ่มเติม'}</p>}
      {candidate.assessment && <ScoreDetails assessment={candidate.assessment} onSeek={onSeek} />}
      <button type="button" disabled={accepted.has(candidate.id) || accepting[candidate.id] || candidate.end - candidate.start < 2} className="w-full rounded-lg border border-line3 px-3 py-2 text-[14px] text-accent disabled:opacity-50" onClick={async () => {
        setAccepting(old => ({ ...old, [candidate.id]: true })); setError(null); setNotice('');
        try { checkResponse(await api.videos({ id: videoId }).clips.post({ candidateId: candidate.id })); setNotice('เพิ่มคลิปแล้ว ดูได้ที่คลิปของฉัน'); onAccepted(); }
        catch (error) { setError(error); } finally { setAccepting(old => ({ ...old, [candidate.id]: false })); }
      }}>{accepted.has(candidate.id) ? '✓ เพิ่มเป็นคลิปแล้ว' : accepting[candidate.id] ? 'กำลังเพิ่ม…' : candidate.end - candidate.start < 2 ? 'ช่วงนี้สั้นกว่า 2 วินาที' : 'เพิ่มเป็นคลิป'}</button>
      <CandidateFeedback videoId={videoId} candidate={candidate} onSaved={() => void analysis.refresh()} />
    </li>)}</ul>
  </section>;
}
