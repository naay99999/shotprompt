'use client';
import { useRef, useState } from 'react';
import { fmtTime } from '@/lib/format';
import { rangeError } from '@/lib/editor-actions';
import { ErrorNotice } from './ui-feedback';
export type TimelineCandidate = { id: string; start: number; end: number; score: number | null };
export function Timeline({ duration, currentTime, candidates, onSeek, onCreateRange }: {
  duration: number; currentTime: number; candidates: TimelineCandidate[]; onSeek: (time: number) => void; onCreateRange: (start: number, end: number) => Promise<void>;
}) {
  const track = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ time: number; x: number } | null>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [start, setStart] = useState('0');
  const [end, setEnd] = useState(String(Math.min(30, duration)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  function time(x: number) {
    const rect = track.current!.getBoundingClientRect();
    return rect.width ? Math.max(0, Math.min(duration, (x - rect.left) / rect.width * duration)) : 0;
  }
  return <section className="space-y-3 rounded-xl border border-line3 bg-surface p-4"><h2 className="font-semibold">แถบเวลา</h2>
    <p className="text-[12px] text-muted">แถบสีคือช่วงแนะนำ คลิกเพื่อดูวิดีโอ ลากเพื่อเลือกช่วง หรือกรอกเวลาเริ่มและจบด้านล่าง</p>
    <div ref={track} className="relative h-11 touch-none overflow-hidden rounded-lg bg-bg" aria-hidden="true"
      onPointerDown={event => { if (event.button !== 0 || busy || duration <= 0) return; anchor.current = { time: time(event.clientX), x: event.clientX }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (!anchor.current) return; const current = time(event.clientX); setSelection({ start: Math.min(anchor.current.time, current), end: Math.max(anchor.current.time, current) }); }}
      onPointerUp={event => {
        const from = anchor.current; anchor.current = null; if (!from) return;
        if (Math.abs(event.clientX - from.x) < 4) { onSeek(from.time); setSelection(null); return; }
        const current = time(event.clientX); const next = { start: Math.min(from.time, current), end: Math.max(from.time, current) };
        setSelection(next); setStart(next.start.toFixed(1)); setEnd(next.end.toFixed(1)); setValidation(rangeError(next.start, next.end, duration));
      }} onPointerCancel={() => { anchor.current = null; setSelection(null); }}>
      {candidates.map(candidate => <span key={candidate.id} className="absolute top-2 bottom-2 rounded bg-accent/60" style={{ left: `${duration ? candidate.start / duration * 100 : 0}%`, width: `${duration ? (candidate.end - candidate.start) / duration * 100 : 0}%`, minWidth: 3 }} />)}
      {selection && <span className="absolute inset-y-0 border-2 border-accent bg-accent/20" style={{ left: `${selection.start / duration * 100}%`, width: `${(selection.end - selection.start) / duration * 100}%` }} />}
      <span className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `${duration ? currentTime / duration * 100 : 0}%` }} />
    </div>
    <label className="block text-[12px] text-muted">ตำแหน่งที่ดู {fmtTime(currentTime)} / {fmtTime(duration)}<input type="range" min={0} max={duration || 1} step={0.1} value={Math.min(currentTime, duration)} disabled={!duration} onChange={event => onSeek(Number(event.target.value))} className="block w-full" /></label>
    <form className="space-y-3" onSubmit={async event => {
      event.preventDefault(); if (busy) return; const a = start.trim() ? Number(start) : NaN; const b = end.trim() ? Number(end) : NaN;
      const invalid = rangeError(a, b, duration); setValidation(invalid); if (invalid) return;
      setBusy(true); setError(null); setNotice('');
      try { await onCreateRange(a, b); setNotice('สร้างคลิปแล้ว ดูได้ที่คลิปของฉัน'); setSelection(null); } catch (error) { setError(error); } finally { setBusy(false); }
    }}><fieldset disabled={busy} className="flex flex-wrap items-end gap-3">
      <label className="min-w-0 flex-1 text-[12px] text-muted">เริ่ม (วินาที)<input type="number" min={0} max={duration} step={0.1} required value={start} onChange={event => setStart(event.target.value)} className="mt-1 block w-full min-w-0 rounded-lg border border-line3 bg-bg px-2 py-2 text-[14px] text-ink" /></label>
      <label className="min-w-0 flex-1 text-[12px] text-muted">จบ (วินาที)<input type="number" min={0} max={duration} step={0.1} required value={end} onChange={event => setEnd(event.target.value)} className="mt-1 block w-full min-w-0 rounded-lg border border-line3 bg-bg px-2 py-2 text-[14px] text-ink" /></label>
      <button type="submit" disabled={!duration} className="rounded-lg bg-accent px-4 py-2 font-semibold text-bg">{busy ? 'กำลังสร้าง…' : 'สร้างคลิป'}</button>
    </fieldset><p className="text-[12px] text-muted">คลิปต้องยาวอย่างน้อย 2 วินาที</p>{validation && <p role="alert" className="text-[12px] text-err">{validation}</p>}<ErrorNotice error={error} fallback="สร้างคลิปไม่สำเร็จ ลองอีกครั้งได้" /><p role="status" className="text-[14px] text-ok">{notice}</p></form>
  </section>;
}
