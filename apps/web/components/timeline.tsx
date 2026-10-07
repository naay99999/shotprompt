'use client';

import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Crosshair, MagnifyingGlassMinus, MagnifyingGlassPlus } from '@phosphor-icons/react';
import { fmtTime } from '@/lib/format';
import { rangeError } from '@/lib/editor-actions';
import { normalizeViewport, panViewport, rangeInViewport, timeAtFraction, timelineTicks, zoomViewport, type TimelineViewport } from '@/lib/timeline-view';
import { ErrorNotice } from './ui-feedback';

export type TimelineCandidate = { id: string; start: number; end: number; score: number | null };

export function Timeline({ duration, currentTime, candidates, onSeek, onCreateRange, selectedRange }: {
  duration: number;
  currentTime: number;
  candidates: TimelineCandidate[];
  onSeek: (time: number) => void;
  onCreateRange: (start: number, end: number) => Promise<void>;
  selectedRange?: TimelineViewport | null;
}) {
  const total = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const playhead = Number.isFinite(currentTime) ? Math.max(0, Math.min(total, currentTime)) : 0;
  const track = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ time: number; x: number } | null>(null);
  const [viewport, setViewport] = useState<TimelineViewport>({ start: 0, end: total });
  const [selection, setSelection] = useState<TimelineViewport | null>(null);
  const [start, setStart] = useState('0');
  const [end, setEnd] = useState(String(Math.min(30, total)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const view = normalizeViewport(viewport, total);
  const span = view.end - view.start;
  const ticks = timelineTicks(view, 6);
  const active = selectedRange ? rangeInViewport(selectedRange, view) : null;
  const draft = selection ? rangeInViewport(selection, view) : null;
  const fraction = (value: number) => span ? (value - view.start) / span : 0;

  function time(x: number) {
    const rect = track.current?.getBoundingClientRect();
    return timeAtFraction(view, rect?.width ? (x - rect.left) / rect.width : 0);
  }

  function zoom(factor: number) {
    const focus = playhead >= view.start && playhead <= view.end ? playhead : view.start + span / 2;
    setViewport(zoomViewport(view, total, factor, focus));
  }

  return <section className="sp-timeline min-w-0 space-y-2" aria-label="แถบเวลาและสร้างคลิป">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-baseline gap-3">
        <h2 className="font-semibold text-ink">แถบเวลา</h2>
        <span className="text-[11px] tabular-nums text-muted">{fmtTime(view.start)} – {fmtTime(view.end)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="ปรับมุมมองแถบเวลา">
        <button type="button" className="sp-button sp-button-quiet min-h-8! h-8 w-8 p-0!" aria-label="เลื่อนแถบเวลาไปก่อนหน้า" title="เลื่อนไปก่อนหน้า" disabled={!total || view.start <= 0} onClick={() => setViewport(panViewport(view, total, -span / 2))}><ArrowLeft size={15} /></button>
        <button type="button" className="sp-button sp-button-quiet min-h-8! h-8 w-8 p-0!" aria-label="เลื่อนแถบเวลาไปถัดไป" title="เลื่อนไปถัดไป" disabled={!total || view.end >= total} onClick={() => setViewport(panViewport(view, total, span / 2))}><ArrowRight size={15} /></button>
        <span className="mx-1 h-4 border-l border-line3" aria-hidden="true" />
        <button type="button" className="sp-button sp-button-quiet min-h-8! h-8 w-8 p-0!" aria-label="ซูมออกแถบเวลา" title="ซูมออก" disabled={!total || span >= total} onClick={() => zoom(2)}><MagnifyingGlassMinus size={17} /></button>
        <button type="button" className="sp-button sp-button-quiet min-h-8! h-8 w-8 p-0!" aria-label="ซูมเข้าแถบเวลา" title="ซูมเข้า" disabled={!total || span <= Math.min(5, total)} onClick={() => zoom(0.5)}><MagnifyingGlassPlus size={17} /></button>
        <button type="button" className="sp-button sp-button-quiet min-h-8! h-8 w-8 p-0!" aria-label="แสดงตำแหน่งที่กำลังดู" title="แสดงตำแหน่งที่กำลังดู" disabled={!total || span >= total} onClick={() => setViewport(panViewport(view, total, playhead - (view.start + span / 2)))}><Crosshair size={17} /></button>
        <button type="button" className="sp-button sp-button-quiet min-h-8! h-8 px-2! text-[11px]!" disabled={!total || span >= total} onClick={() => setViewport({ start: 0, end: total })}>ทั้งหมด</button>
      </div>
    </div>

    <div ref={track} className="relative h-20 touch-none overflow-hidden rounded-lg border border-line3 bg-bg" aria-hidden="true"
      onPointerDown={event => {
        if (event.button !== 0 || busy || !total) return;
        anchor.current = { time: time(event.clientX), x: event.clientX };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        if (!anchor.current) return;
        const current = time(event.clientX);
        setSelection({ start: Math.min(anchor.current.time, current), end: Math.max(anchor.current.time, current) });
      }}
      onPointerUp={event => {
        const from = anchor.current;
        anchor.current = null;
        if (!from) return;
        if (Math.abs(event.clientX - from.x) < 4) { onSeek(from.time); setSelection(null); return; }
        const current = time(event.clientX);
        const next = { start: Math.min(from.time, current), end: Math.max(from.time, current) };
        setSelection(next);
        setStart(next.start.toFixed(1));
        setEnd(next.end.toFixed(1));
        setValidation(rangeError(next.start, next.end, total));
      }}
      onPointerCancel={() => { anchor.current = null; setSelection(null); }}>
      <div className="absolute inset-x-0 top-0 h-7 border-b border-line3">
        {ticks.map((tick, index) => {
          const edge = index === 0 || index === ticks.length - 1;
          const position = fraction(tick);
          if (!edge && (position < 0.12 || position > 0.88)) return null;
          return <span key={tick} className="absolute inset-y-0 border-l border-line3" style={{ left: `${position * 100}%` }}>
            <span className={`${edge ? '' : 'hidden sm:block'} absolute top-1 whitespace-nowrap font-mono text-[10px] text-muted`} style={{ transform: index === 0 ? 'translateX(4px)' : index === ticks.length - 1 ? 'translateX(calc(-100% - 4px))' : 'translateX(-50%)' }}>{fmtTime(tick)}</span>
          </span>;
        })}
      </div>
      {candidates.map(candidate => {
        const visible = rangeInViewport(candidate, view);
        return visible && <span key={candidate.id} className="absolute bottom-3 top-10 rounded-sm bg-accent/40" style={{ left: `${visible.left * 100}%`, width: `${visible.width * 100}%`, minWidth: 2 }} />;
      })}
      {active && <span className="absolute bottom-2 top-8 rounded-sm border border-dashed border-accent bg-accent/15" style={{ left: `${active.left * 100}%`, width: `${active.width * 100}%` }} />}
      {draft && <span className="absolute bottom-1 top-8 rounded-sm border-2 border-accent bg-accent/25" style={{ left: `${draft.left * 100}%`, width: `${draft.width * 100}%` }} />}
      {playhead >= view.start && playhead <= view.end && <span className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `calc(${fraction(playhead) * 100}% - ${playhead === view.end ? 2 : 0}px)` }} />}
    </div>

    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-muted">
      <p>คลิกเพื่อดู · ลากเพื่อเลือกช่วง · ซูมเพื่อเลือกวินาที</p>
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-accent/40" aria-hidden="true" />ช่วงแนะนำ</span>
        {selectedRange && <span className="flex items-center gap-1.5"><i className="h-2 w-2 border border-dashed border-accent" aria-hidden="true" />คลิปที่เลือก</span>}
      </div>
    </div>

    <div className={`grid gap-x-4 gap-y-1 ${span < total ? 'sm:grid-cols-2' : ''}`}>
    {span < total && <label className="flex items-center gap-3 text-[11px] text-muted">เลื่อนมุมมอง
      <input type="range" min={0} max={total - span} step={0.1} value={view.start} onChange={event => setViewport(panViewport(view, total, Number(event.target.value) - view.start))} className="min-w-0 flex-1 accent-accent" />
    </label>}
    <label className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
      <span className="tabular-nums">ตำแหน่งที่ดู {fmtTime(playhead)} / {fmtTime(total)}</span>
      <input type="range" aria-label="เลื่อนไปยังเวลาในวิดีโอ" min={0} max={total || 1} step={0.1} value={playhead} disabled={!total} onChange={event => {
        const next = Number(event.target.value);
        onSeek(next);
        if (next < view.start || next > view.end) setViewport(panViewport(view, total, next - (view.start + span / 2)));
      }} className="min-w-32 flex-1 accent-accent" />
    </label>
    </div>

    <form className="space-y-2 border-t border-line3 pt-3" onSubmit={async event => {
      event.preventDefault();
      if (busy) return;
      const a = start.trim() ? Number(start) : NaN;
      const b = end.trim() ? Number(end) : NaN;
      const invalid = rangeError(a, b, total);
      setValidation(invalid);
      if (invalid) return;
      setBusy(true); setError(null); setNotice('');
      try { await onCreateRange(a, b); setNotice('สร้างคลิปแล้ว ดูได้ที่คลิปของฉัน'); setSelection(null); }
      catch (error) { setError(error); }
      finally { setBusy(false); }
    }}>
      <fieldset disabled={busy} className="flex flex-wrap items-end gap-2">
        <label className="min-w-20 flex-1 text-[11px] text-muted">เริ่ม (วินาที)
          <input type="number" min={0} max={total} step={0.1} required value={start} onChange={event => { setStart(event.target.value); setSelection(null); }} className="mt-1 block w-full min-w-0 rounded-lg border border-line3 bg-bg px-2 py-2 text-[13px] tabular-nums text-ink" />
        </label>
        <label className="min-w-20 flex-1 text-[11px] text-muted">จบ (วินาที)
          <input type="number" min={0} max={total} step={0.1} required value={end} onChange={event => { setEnd(event.target.value); setSelection(null); }} className="mt-1 block w-full min-w-0 rounded-lg border border-line3 bg-bg px-2 py-2 text-[13px] tabular-nums text-ink" />
        </label>
        <button type="submit" disabled={!total} className="sp-button sp-button-primary">{busy ? 'กำลังสร้าง…' : 'สร้างคลิป'}</button>
      </fieldset>
      <p className="text-[11px] text-muted">คลิปต้องยาวอย่างน้อย 2 วินาที · กรอกเวลาเพื่อเลือกช่วงด้วยคีย์บอร์ด</p>
      {validation && <p role="alert" className="text-[12px] text-err">{validation}</p>}
      <ErrorNotice error={error} fallback="สร้างคลิปไม่สำเร็จ ลองอีกครั้งได้" />
      {notice && <p role="status" className="text-[12px] text-ok">{notice}</p>}
    </form>
  </section>;
}
