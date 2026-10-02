'use client';
import { useState } from 'react';
import type { CandidateView, FeedbackVerdict } from '@shotprompt/core';
import { api } from '@/lib/api';
import { checkResponse } from '@/lib/ui-error';
import { ErrorNotice } from './ui-feedback';
const labels: Record<FeedbackVerdict, string> = { good: 'ช่วงนี้ดี', irrelevant: 'ไม่ตรงประเด็น', 'starts-mid-thought': 'เริ่มกลางเรื่อง', 'ends-too-soon': 'จบเร็วไป', duplicate: 'เนื้อหาซ้ำ' };
export function CandidateFeedback({ videoId, candidate, onSaved }: { videoId: string; candidate: CandidateView; onSaved: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  async function save(verdict: string) {
    setBusy(true); setError(null);
    try {
      const route = api.videos({ id: videoId }).candidates({ candidateId: candidate.id }).feedback;
      checkResponse(verdict ? await route.put({ verdict }) : await route.delete()); onSaved();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return <div><label className="flex flex-col gap-1 text-[12px] text-muted">ความเห็นต่อช่วงนี้<select disabled={busy} value={candidate.feedback ?? ''} onChange={event => void save(event.target.value)} className="rounded border border-line3 bg-bg p-2 text-ink"><option value="">ยังไม่ให้ความเห็น / ล้าง</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><ErrorNotice error={error} /></div>;
}
