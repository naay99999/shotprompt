'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { api, API_BASE } from '@/lib/api'
import { fmtTime } from '@/lib/format'
import type { Clip } from '@/components/clip-strip'

type SubtitleRow = { id?: number; start: number; end: number; text: string }

function cropLabel(crop: number) {
  if (Math.abs(crop) < 0.005) return 'กลาง'
  return (crop > 0 ? 'ขวา ' : 'ซ้าย ') + Math.abs(Math.round(crop * 100)) + '%'
}

/** 9:16 crop-frame overlay, portaled into the player container so it renders
 * on top of the <video> element that lives in the main column (page.tsx). */
function CropOverlay({ containerRef, offset }: { containerRef: RefObject<HTMLDivElement | null>; offset: number }) {
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

  const overlayW = dims.h * (9 / 16)
  const maxShift = Math.max(0, (dims.w - overlayW) / 2)
  const centerX = dims.w / 2 + offset * maxShift

  return createPortal(
    <div
      className="pointer-events-none absolute top-0 bottom-0 rounded-md border-2 border-accent transition-[left] duration-150 ease-out"
      style={{ left: centerX - overlayW / 2, width: overlayW, boxShadow: '0 0 0 999px rgba(10,9,8,.55)' }}
    >
      <div className="absolute top-2 left-1/2 -translate-x-1/2 rounded-[5px] bg-accent px-2 py-0.5 font-mono text-[10.5px] font-bold text-[#1a120b]">
        9:16
      </div>
    </div>,
    el,
  )
}

export function ClipEditor({
  clip,
  duration,
  videoContainerRef,
  onClose,
  onUpdated,
  onDeleted,
}: {
  clip: Clip
  duration: number
  videoContainerRef: RefObject<HTMLDivElement | null>
  onClose: () => void
  onUpdated: () => void
  onDeleted: () => void
}) {
  const [start, setStart] = useState(clip.start)
  const [end, setEnd] = useState(clip.end)
  const [crop, setCrop] = useState(clip.cropOffset)
  const [subtitles, setSubtitles] = useState<SubtitleRow[]>([])
  const [subsDirty, setSubsDirty] = useState(false)
  const [subsSaving, setSubsSaving] = useState(false)
  const [editingTimeIdx, setEditingTimeIdx] = useState<number | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const firstTrimRun = useRef(true)
  const firstCropRun = useRef(true)
  const pendingTrimRef = useRef<{ start: number; end: number } | null>(null)
  const pendingCropRef = useRef<number | null>(null)

  const maxEnd = duration > 0 ? duration : Infinity

  function refetchSubtitles() {
    api.clips({ id: clip.id }).subtitles.get().then(r => {
      if (r.data) setSubtitles(r.data)
    })
  }

  useEffect(() => {
    refetchSubtitles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id])

  // Debounced PATCH for trim — extending the range may add new transcript-derived
  // subtitle rows server-side, so refetch subtitles once the patch lands.
  useEffect(() => {
    if (firstTrimRun.current) {
      firstTrimRun.current = false
      return
    }
    pendingTrimRef.current = { start, end }
    const t = setTimeout(async () => {
      pendingTrimRef.current = null
      await api.clips({ id: clip.id }).patch({ start, end })
      refetchSubtitles()
      onUpdated()
    }, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end])

  // Debounced PATCH for crop offset — the overlay above updates immediately from
  // local state; only the network call is debounced.
  useEffect(() => {
    if (firstCropRun.current) {
      firstCropRun.current = false
      return
    }
    pendingCropRef.current = crop
    const t = setTimeout(async () => {
      pendingCropRef.current = null
      await api.clips({ id: clip.id }).patch({ cropOffset: crop })
      onUpdated()
    }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crop])

  // Flush any still-pending debounced PATCH on unmount (e.g. the user edits trim/crop
  // and immediately switches clips or closes the panel before the debounce fires) —
  // otherwise clearTimeout above would silently cancel the write and drop the edit.
  useEffect(() => {
    return () => {
      const trim = pendingTrimRef.current
      if (trim) api.clips({ id: clip.id }).patch(trim).then(onUpdated)
      const crop = pendingCropRef.current
      if (crop !== null) api.clips({ id: clip.id }).patch({ cropOffset: crop }).then(onUpdated)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function stepStart(e: React.MouseEvent, sign: 1 | -1) {
    const delta = (e.shiftKey ? 0.1 : 1.0) * sign
    setStart(s => Math.max(0, Math.min(s + delta, end - 2)))
  }
  function stepEnd(e: React.MouseEvent, sign: 1 | -1) {
    const delta = (e.shiftKey ? 0.1 : 1.0) * sign
    setEnd(v => Math.max(start + 2, Math.min(v + delta, maxEnd)))
  }

  function editSubtitleText(i: number, text: string) {
    setSubtitles(rows => rows.map((r, j) => (j === i ? { ...r, text } : r)))
    setSubsDirty(true)
  }
  function editSubtitleTime(i: number, field: 'start' | 'end', value: number) {
    setSubtitles(rows => rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)))
    setSubsDirty(true)
  }
  async function saveSubtitles() {
    setSubsSaving(true)
    await api.clips({ id: clip.id }).subtitles.put({
      subtitles: subtitles.map(s => ({ start: s.start, end: s.end, text: s.text })),
    })
    setSubsSaving(false)
    setSubsDirty(false)
  }

  async function deleteClip() {
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    setDeleting(true)
    await api.clips({ id: clip.id }).delete()
    setDeleting(false)
    onDeleted()
  }

  return (
    <div className="flex w-[360px] flex-none flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <CropOverlay containerRef={videoContainerRef} offset={crop} />

      <div className="flex items-center justify-between border-b border-line px-[18px] py-3.5">
        <div className="text-[14.5px] font-bold">
          แก้ไขคลิป{' '}
          <span className="font-mono text-[12px] font-normal text-dim">
            {fmtTime(start)} – {fmtTime(end)}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] text-[13px] text-dim transition-colors hover:bg-line2 hover:text-ink"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-[22px] overflow-y-auto p-[18px]">
        {/* Trim */}
        <div className="flex flex-col gap-2.5">
          <div className="text-[11.5px] font-semibold tracking-[.4px] text-faint">ช่วงเวลา (TRIM)</div>
          <div className="flex gap-2.5">
            <div className="flex-1 rounded-[10px] border border-line2 bg-surface2 px-3 py-2.5">
              <div className="mb-[3px] text-[10.5px] text-faint">เริ่ม</div>
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={e => stepStart(e, -1)}
                  className="px-1 text-[15px] text-dim transition-colors hover:text-accent"
                >
                  ‹
                </button>
                <span className="font-mono text-[13.5px]">{fmtTime(start)}</span>
                <button
                  type="button"
                  onClick={e => stepStart(e, 1)}
                  className="px-1 text-[15px] text-dim transition-colors hover:text-accent"
                >
                  ›
                </button>
              </div>
            </div>
            <div className="flex-1 rounded-[10px] border border-line2 bg-surface2 px-3 py-2.5">
              <div className="mb-[3px] text-[10.5px] text-faint">จบ</div>
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={e => stepEnd(e, -1)}
                  className="px-1 text-[15px] text-dim transition-colors hover:text-accent"
                >
                  ‹
                </button>
                <span className="font-mono text-[13.5px]">{fmtTime(end)}</span>
                <button
                  type="button"
                  onClick={e => stepEnd(e, 1)}
                  className="px-1 text-[15px] text-dim transition-colors hover:text-accent"
                >
                  ›
                </button>
              </div>
            </div>
          </div>
          <div className="text-[12px] text-dim">
            ความยาว <span className="font-mono text-ink">{(end - start).toFixed(1)} วินาที</span> · ขยายช่วงแล้ว subtitle
            เดิมที่แก้ไว้ไม่หาย
          </div>
        </div>

        {/* Crop */}
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <div className="text-[11.5px] font-semibold tracking-[.4px] text-faint">ตำแหน่งครอป 9:16</div>
            <div className="font-mono text-[11.5px] text-accent">{cropLabel(crop)}</div>
          </div>
          <input
            type="range"
            min={-100}
            max={100}
            value={Math.round(crop * 100)}
            onChange={e => setCrop(Number(e.target.value) / 100)}
            className="w-full cursor-pointer"
          />
          <div className="flex justify-between text-[11px] text-faint">
            <span>ซ้าย</span>
            <span>กลาง</span>
            <span>ขวา</span>
          </div>
        </div>

        {/* Subtitles */}
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <div className="text-[11.5px] font-semibold tracking-[.4px] text-faint">SUBTITLE ({subtitles.length})</div>
            <div className="flex items-center gap-2.5">
              {subsDirty && (
                <button
                  type="button"
                  onClick={saveSubtitles}
                  disabled={subsSaving}
                  className="rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-semibold text-[#1a120b] transition-[filter] hover:brightness-110 disabled:opacity-50"
                >
                  {subsSaving ? 'กำลังบันทึก…' : 'บันทึก'}
                </button>
              )}
              <a
                href={`${API_BASE}/clips/${clip.id}/srt`}
                className="text-[12px] text-dim hover:text-accent hover:underline"
              >
                ↓ ดาวน์โหลด .srt
              </a>
            </div>
          </div>
          {subtitles.length === 0 && <div className="text-[12px] text-faint">ยังไม่มี subtitle ในช่วงนี้</div>}
          {subtitles.map((s, i) => (
            <div
              key={s.id ?? i}
              className="rounded-[10px] border border-line bg-surface2 px-3 py-2.5 transition-colors hover:border-line3"
            >
              {editingTimeIdx === i ? (
                <div className="mb-1 flex items-center gap-1.5 font-mono text-[11px]">
                  <input
                    type="number"
                    step={0.1}
                    value={s.start}
                    onChange={e => editSubtitleTime(i, 'start', Number(e.target.value))}
                    className="w-[64px] rounded border border-line2 bg-transparent px-1 py-0.5 text-ink"
                  />
                  <span className="text-faint">→</span>
                  <input
                    type="number"
                    step={0.1}
                    value={s.end}
                    onChange={e => editSubtitleTime(i, 'end', Number(e.target.value))}
                    className="w-[64px] rounded border border-line2 bg-transparent px-1 py-0.5 text-ink"
                  />
                  <button
                    type="button"
                    onClick={() => setEditingTimeIdx(null)}
                    className="px-1 text-ok transition-colors hover:brightness-110"
                  >
                    ✓
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingTimeIdx(i)}
                  className="mb-1 block font-mono text-[10.5px] text-faint hover:text-accent"
                >
                  {fmtTime(s.start)} → {fmtTime(s.end)}
                </button>
              )}
              <input
                value={s.text}
                onChange={e => editSubtitleText(i, e.target.value)}
                className="w-full border-none bg-transparent p-0 text-[13.5px] text-ink"
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={deleteClip}
          disabled={deleting}
          onBlur={() => setConfirmingDelete(false)}
          className="rounded-[9px] border border-err/30 bg-transparent px-2.5 py-2.5 text-[12.5px] text-err transition-colors hover:bg-err/10 disabled:opacity-50"
        >
          {deleting ? 'กำลังลบ…' : confirmingDelete ? 'ยืนยันลบคลิปนี้?' : 'ลบคลิปนี้'}
        </button>
      </div>
    </div>
  )
}
