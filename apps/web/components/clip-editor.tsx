'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ConfirmDialog, ErrorNotice } from '@/components/ui-feedback'
import { useNavigationGuard } from '@/components/navigation-guard'
import { checkResponse } from '@/lib/ui-error'
import { createSaveQueue, rangeError, mergeSubtitleEdits, subtitleRangeError } from '@/lib/editor-actions'
import { api, API_BASE } from '@/lib/api'
import { isAssessmentStale } from '@/lib/analysis-view'
import { ScoreDetails } from './score-details'
import { fmtTime } from '@/lib/format'
import { cropPreviewRect } from '@/lib/video-crop'
import type { Clip } from '@/components/clip-strip'
import { Scissors, BoundingBox, Subtitles, X, Trash } from '@phosphor-icons/react'
import { handleTabKeyDown } from '@/lib/tab-keyboard'

type SubtitleRow = { id?: number; start: number; end: number; text: string }

function cropLabel(crop: number) {
  if (Math.abs(crop) < 0.005) return 'กลาง'
  return (crop > 0 ? 'ขวา ' : 'ซ้าย ') + Math.abs(Math.round(crop * 100)) + '%'
}

/** 9:16 crop-frame overlay, portaled into the player container so it renders
 * on top of the <video> element that lives in the main column (page.tsx). */
function CropOverlay({
  containerRef,
  offset,
  videoWidth,
  videoHeight,
}: {
  containerRef: RefObject<HTMLDivElement | null>
  offset: number
  videoWidth: number
  videoHeight: number
}) {
  const [dims, setDims] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setDims({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [containerRef])

  const el = containerRef.current
  if (!el || dims.w === 0 || dims.h === 0) return null

  const cropRect = cropPreviewRect(dims.w, dims.h, videoWidth, videoHeight, offset)
  if (!cropRect) return null

  return createPortal(
    <div
      className="pointer-events-none absolute z-10 rounded-md border-2 border-accent transition-[left,top,width,height] duration-150 ease-out"
      style={{ ...cropRect, boxShadow: '0 0 0 999px rgba(10,9,8,.55)' }}
    >
      <div className="absolute top-2 left-1/2 -translate-x-1/2 rounded-[5px] bg-accent px-2 py-0.5 font-mono text-[12px] font-bold text-[#1a120b]">
        9:16
      </div>
    </div>,
    el,
  )
}

export function ClipEditor({ clip, duration, videoContainerRef, videoWidth, videoHeight, onClose, onUpdated, onDeleted, active = true }: {
  clip: Clip; duration: number; videoContainerRef: RefObject<HTMLDivElement | null>; videoWidth: number; videoHeight: number;
  onClose: () => void; onUpdated: () => void; onDeleted: () => void;
  active?: boolean;
}) {
  const [tool, setTool] = useState<'trim' | 'frame' | 'subtitles'>('trim');
  const [start, setStart] = useState(clip.start);
  const [end, setEnd] = useState(clip.end);
  const [crop, setCrop] = useState(clip.cropOffset);
  const [persisted, setPersisted] = useState({ start: clip.start, end: clip.end, cropOffset: clip.cropOffset });
  const [subtitles, setSubtitles] = useState<SubtitleRow[]>([]);
  const [subsDirty, setSubsDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [autoSaving, setAutoSaving] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState('');
  const enqueue = useRef(createSaveQueue()).current;
  const dirtyRef = useRef(false);
  const submittedSubtitles = useRef<SubtitleRow[] | null>(null);
  const persistedRef = useRef(persisted);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const { register, request } = useNavigationGuard();
  dirtyRef.current = subsDirty;
  const boundsDirty = start !== persisted.start || end !== persisted.end || crop !== persisted.cropOffset;
  const invalidRange = rangeError(start, end, duration);
  const invalidSubtitles = subtitleRangeError(subtitles, duration);

  async function loadSubtitles() {
    setLoading(true); setLoadError(null);
    try { const response = checkResponse(await api.clips({ id: clip.id }).subtitles.get()); if (alive.current && !dirtyRef.current && response.data) { submittedSubtitles.current = null; setSubtitles(response.data); } }
    catch (error) { if (alive.current) setLoadError(error); }
    finally { if (alive.current) setLoading(false); }
  }
  useEffect(() => {
    alive.current = true; void loadSubtitles();
    return () => { alive.current = false; };
    // The editor remounts for each clip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id]);

  useEffect(() => {
    if (!boundsDirty || invalidRange || confirmDelete) return;
    const draft = { start, end, cropOffset: crop };
    const timer = setTimeout(() => {
      setAutoSaving(count => count + 1); setError(null);
      void enqueue(async () => {
        checkResponse(await api.clips({ id: clip.id }).patch(draft));
        if (alive.current) { persistedRef.current = draft; setPersisted(draft); onUpdated(); if (!dirtyRef.current) await loadSubtitles(); }
      }).catch(error => { if (alive.current) setError(error); }).finally(() => { if (alive.current) setAutoSaving(count => count - 1); });
    }, 400);
    timerRef.current = timer;
    return () => clearTimeout(timer);
    // Only a new user edit schedules a write; failed writes wait for explicit retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end, crop, confirmDelete]);

  async function saveAll(): Promise<boolean> {
    if (invalidRange || invalidSubtitles || saving || loading || loadError) return false;
    setSaving(true); setError(null); setNotice('');
    const draft = { start, end, cropOffset: crop };
    try {
      await enqueue(async () => {
        checkResponse(await api.clips({ id: clip.id }).patch(draft));
        if (subsDirty) {
          const latest = checkResponse(await api.clips({ id: clip.id }).subtitles.get());
          const merged = mergeSubtitleEdits(latest.data ?? [], subtitles, submittedSubtitles.current);
          setSubtitles(merged);
          submittedSubtitles.current = merged;
          checkResponse(await api.clips({ id: clip.id }).subtitles.put({ subtitles: merged.map(({ start, end, text }) => ({ start, end, text })) }));
        }
      });
      persistedRef.current = draft; setPersisted(draft); setSubsDirty(false); dirtyRef.current = false; setNotice('บันทึกแล้ว'); onUpdated(); await loadSubtitles();
      return true;
    } catch (error) { setError(error); return false; } finally { setSaving(false); }
  }
  useEffect(() => {
    register({ dirty: subsDirty || boundsDirty, save: saveAll, discard: async () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      await enqueue(async () => {});
      dirtyRef.current = false; setSubsDirty(false);
      const saved = persistedRef.current;
      setStart(saved.start); setEnd(saved.end); setCrop(saved.cropOffset);
      await loadSubtitles();
    } });
    return () => register(null);
  });
  function editSubtitle(index: number, patch: Partial<SubtitleRow>) {
    dirtyRef.current = true; setSubsDirty(true); setNotice('');
    setSubtitles(rows => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  }
  return <section aria-label="แก้ไขคลิป" className="sp-tool-panel">
    {active && tool === 'frame' && <CropOverlay containerRef={videoContainerRef} offset={crop} videoWidth={videoWidth} videoHeight={videoHeight} />}
    <header className="flex items-center justify-between gap-2"><div><h2 className="sp-section-title">แก้ไขคลิป</h2><p className="mt-1 text-[12px] text-muted tabular-nums">{fmtTime(clip.start)} – {fmtTime(clip.end)}</p></div><button type="button" aria-label="ปิดการแก้ไขคลิป" onClick={() => request(onClose)} className="sp-button sp-button-quiet"><X size={17} aria-hidden="true" /></button></header>
    <div className="sp-tabs mb-5" role="tablist" aria-label="เครื่องมือตัดต่อ" onKeyDown={handleTabKeyDown}>{([
      ['trim', 'ตัดช่วง', Scissors], ['frame', 'จัดเฟรม', BoundingBox], ['subtitles', 'คำบรรยาย', Subtitles],
    ] as const).map(([key, label, Icon]) => <button key={key} type="button" role="tab" tabIndex={tool === key ? 0 : -1} id={`tool-${clip.id}-${key}`} aria-selected={tool === key} aria-controls={`panel-${clip.id}-${key}`} onClick={() => setTool(key)} className="sp-tab px-2 text-[12px]"><Icon size={15} aria-hidden="true" />{label}</button>)}</div>
    <div className="space-y-5">
      <p role="status" className="text-[12px] text-muted">{saving || autoSaving > 0 ? 'กำลังบันทึก…' : subsDirty ? 'มีคำบรรยายที่ยังไม่บันทึก' : boundsDirty ? 'มีการแก้ไขที่ยังไม่บันทึก' : notice || 'เวลาและการจัดเฟรมจะบันทึกอัตโนมัติ'}</p>
      <ErrorNotice error={error} fallback="บันทึกไม่สำเร็จ การแก้ไขยังอยู่ในหน้านี้ กรุณาลองบันทึกอีกครั้ง" />
      <fieldset disabled={saving} className="space-y-5">
        <div role="tabpanel" id={`panel-${clip.id}-trim`} aria-labelledby={`tool-${clip.id}-trim`} hidden={tool !== 'trim'}><h3 className="mb-2 font-medium">เวลาเริ่มและจบ</h3><div className="grid grid-cols-2 gap-3">
          <label className="text-[12px] text-muted">เริ่ม (วินาที)<input type="number" min={0} max={duration} step={0.1} value={start} onChange={event => setStart(event.currentTarget.valueAsNumber)} className="mt-1 w-full min-w-0 rounded-lg border border-line3 bg-bg px-2 py-2 text-[14px] text-ink" /></label>
          <label className="text-[12px] text-muted">จบ (วินาที)<input type="number" min={0} max={duration} step={0.1} value={end} onChange={event => setEnd(event.currentTarget.valueAsNumber)} className="mt-1 w-full min-w-0 rounded-lg border border-line3 bg-bg px-2 py-2 text-[14px] text-ink" /></label>
        </div>{invalidRange ? <p role="alert" className="mt-2 text-[12px] text-err">{invalidRange}</p> : <p className="mt-2 text-[12px] text-muted">{fmtTime(start)} – {fmtTime(end)} · ความยาว {(end - start).toFixed(1)} วินาที</p>}</div>
        <div role="tabpanel" id={`panel-${clip.id}-frame`} aria-labelledby={`tool-${clip.id}-frame`} hidden={tool !== 'frame'}><label className="block text-[14px]">จัดเฟรมแนวตั้ง (9:16)<span className="ml-2 text-[12px] text-accent">{cropLabel(crop)}</span>
          <input type="range" min={-100} max={100} value={Math.round(crop * 100)} onChange={event => setCrop(Number(event.target.value) / 100)} className="mt-2 w-full" />
          <span className="flex justify-between text-[12px] text-muted"><span>ซ้าย</span><span>กลาง</span><span>ขวา</span></span>
        </label>
        <p className="mt-3 text-[12px] text-muted">เลื่อนกรอบเพื่อจัดสิ่งที่อยู่ในภาพ กรอบนี้ใช้เมื่อส่งออกแนวตั้ง</p></div>
        <div role="tabpanel" id={`panel-${clip.id}-subtitles`} aria-labelledby={`tool-${clip.id}-subtitles`} hidden={tool !== 'subtitles'} className="space-y-3"><h3 className="font-medium">คำบรรยาย ({subtitles.length})</h3>
          <ErrorNotice error={loadError} onRetry={loadSubtitles} />{invalidSubtitles && <p role="alert" className="text-err">{invalidSubtitles}</p>}{loading && <p role="status">กำลังโหลดคำบรรยาย…</p>}
          {!loading && !loadError && subtitles.length === 0 && <p className="text-[14px] text-muted">ไม่มีคำบรรยายในช่วงนี้ ลองขยายช่วงเวลาหรือถอดเสียงใหม่</p>}
          {subtitles.map((row, index) => <div key={row.id ?? index} className="space-y-2 border-b border-line3 pb-4">
            <label className="block text-[12px] text-muted">คำบรรยายบรรทัดที่ {index + 1}<textarea rows={2} value={row.text} disabled={loading || !!loadError} onChange={event => editSubtitle(index, { text: event.target.value })} className="mt-1 w-full resize-y rounded border border-line3 bg-surface p-2 text-[14px] text-ink" /></label>
            <details><summary className="cursor-pointer text-[12px] text-muted">เวลาแสดง {fmtTime(row.start)} – {fmtTime(row.end)}</summary><div className="grid grid-cols-2 gap-2">
              <label className="text-[12px]">เริ่ม (วินาที)<input type="number" disabled={loading || !!loadError} step={0.1} value={row.start} onChange={event => editSubtitle(index, { start: event.target.valueAsNumber })} className="w-full min-w-0 rounded border border-line3 p-2" /></label>
              <label className="text-[12px]">จบ (วินาที)<input type="number" disabled={loading || !!loadError} step={0.1} value={row.end} onChange={event => editSubtitle(index, { end: event.target.valueAsNumber })} className="w-full min-w-0 rounded border border-line3 p-2" /></label>
            </div></details>
          </div>)}
        </div>
      </fieldset>
      <button type="button" disabled={saving || loading || !!loadError || !!invalidRange || !!invalidSubtitles || (!subsDirty && !boundsDirty)} onClick={() => void saveAll()} className="sp-button sp-button-primary w-full">{saving ? 'กำลังบันทึก…' : 'บันทึกการแก้ไข'}</button>
      <a hidden={tool !== 'subtitles'} href={`${API_BASE}/clips/${clip.id}/srt`} className="inline-flex items-center text-[13px] text-accent">ดาวน์โหลดคำบรรยาย (.srt)</a>
      {subsDirty && <p className="text-[12px] text-muted">บันทึกก่อนดาวน์โหลด เพื่อให้ไฟล์มีข้อความที่แก้ล่าสุด</p>}
      {clip.assessment && <details className="border-t border-line3 pt-3 text-[12px]"><summary className="cursor-pointer text-muted">ผลประเมินจาก AI</summary><div className="mt-3 space-y-2"><p className="text-muted">{isAssessmentStale(clip.assessment, clip.start, clip.end) ? 'ช่วงคลิปถูกแก้ไขแล้ว คะแนนนี้เป็นของช่วงเดิม' : 'ผลประเมินตอนเพิ่มคลิป'}</p><ScoreDetails assessment={clip.assessment.assessment} />{clip.assessment.evaluatorMetadata && <p className="break-words text-muted">โมเดล {clip.assessment.evaluatorMetadata.snapshot.provider.model} · เกณฑ์ {clip.assessment.evaluatorMetadata.snapshot.rubricVersion}</p>}</div></details>}
      <button type="button" onClick={() => setConfirmDelete(true)} disabled={saving || autoSaving > 0} className="sp-button sp-button-quiet w-full text-err"><Trash size={15} aria-hidden="true" />ลบคลิปนี้</button>
      {confirmDelete && <ConfirmDialog title="ลบคลิปนี้?" onClose={() => setConfirmDelete(false)} onConfirm={async () => {
        await enqueue(async () => { checkResponse(await api.clips({ id: clip.id }).delete()); }); register(null); onDeleted();
      }}><p>คลิปช่วง {fmtTime(clip.start)} – {fmtTime(clip.end)} รวมคำบรรยายและไฟล์ส่งออกของคลิปนี้จะถูกลบถาวร วิดีโอต้นฉบับในคลังจะยังอยู่</p></ConfirmDialog>}
    </div>
  </section>;
}
