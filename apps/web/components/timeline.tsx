'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fmtTime } from '@/lib/format'

export type TimelineCandidate = { id: string; start: number; end: number; score: number }

const MIN_CREATE_SECONDS = 2

function colorForScore(score: number) {
  if (score >= 70) return '#e8823f' // accent
  if (score >= 50) return '#d9a13f' // warn
  return '#7a746b' // muted
}

export function Timeline({
  duration,
  currentTime,
  candidates,
  onSeek,
  onCreateRange,
}: {
  duration: number
  currentTime: number
  candidates: TimelineCandidate[]
  onSeek: (t: number) => void
  onCreateRange: (start: number, end: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ start: number; end: number } | null>(null)
  const [pending, setPending] = useState<{ start: number; end: number } | null>(null)

  const toTime = useCallback(
    (clientX: number) => {
      const r = trackRef.current!.getBoundingClientRect()
      if (r.width === 0) return 0
      return Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration))
    },
    [duration],
  )

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || duration <= 0) return
    e.preventDefault()
    const anchor = toTime(e.clientX)
    let dragged = false
    setPending(null)
    setDrag({ start: anchor, end: anchor })

    function move(ev: PointerEvent) {
      const t = toTime(ev.clientX)
      if (Math.abs(t - anchor) > 0.15) dragged = true
      setDrag({ start: Math.min(anchor, t), end: Math.max(anchor, t) })
    }
    function up(ev: PointerEvent) {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const t = toTime(ev.clientX)
      const start = Math.min(anchor, t)
      const end = Math.max(anchor, t)
      setDrag(null)
      if (dragged && end - start >= MIN_CREATE_SECONDS) {
        setPending({ start, end })
      } else if (!dragged) {
        onSeek(anchor)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Click-away to dismiss the pending create-clip confirm.
  useEffect(() => {
    if (!pending) return
    function onDocPointerDown(e: PointerEvent) {
      if (confirmRef.current && !confirmRef.current.contains(e.target as Node)) setPending(null)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPending(null)
    }
    document.addEventListener('pointerdown', onDocPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [pending])

  const sel = drag ?? pending
  const playheadPct = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0

  return (
    <div className="flex flex-none flex-col gap-2.5 rounded-xl border border-line bg-surface px-4 py-3.5">
      <div className="flex items-baseline justify-between">
        <div className="text-[11.5px] font-semibold tracking-[.4px] text-faint">TIMELINE</div>
        <div className="text-[11.5px] text-faint">แถบสี = candidate ตามคะแนน · คลิกเพื่อเลื่อนไปดู · ลากเพื่อสร้างคลิป</div>
      </div>
      <div className="relative">
        <div
          ref={trackRef}
          onPointerDown={onPointerDown}
          className="relative h-11 touch-none select-none overflow-hidden rounded-lg bg-[#131211]"
        >
          {candidates.map(c => {
            const left = duration > 0 ? (c.start / duration) * 100 : 0
            const width = duration > 0 ? ((c.end - c.start) / duration) * 100 : 0
            return (
              <div
                key={c.id}
                title={`${fmtTime(c.start)} – ${fmtTime(c.end)} · ${Math.round(c.score)}`}
                onClick={e => {
                  e.stopPropagation()
                  onSeek(c.start)
                }}
                className="absolute top-2 bottom-2 cursor-pointer rounded-[4px] opacity-85 transition-[opacity,transform] hover:scale-y-[1.12] hover:opacity-100"
                style={{ left: `${left}%`, width: `${width}%`, minWidth: 5, background: colorForScore(c.score) }}
              />
            )
          })}
          {sel && (
            <div
              className="pointer-events-none absolute top-0 bottom-0 bg-accent/30"
              style={{
                left: `${(sel.start / duration) * 100}%`,
                width: `${((sel.end - sel.start) / duration) * 100}%`,
              }}
            />
          )}
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-ink transition-[left] duration-[250ms] ease-out"
            style={{ left: `${playheadPct}%` }}
          />
        </div>

        {pending && (
          <div
            ref={confirmRef}
            className="absolute top-[-46px] z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-line3 bg-surface2 px-3 py-2 shadow-lg"
            style={{ left: `${Math.min(90, Math.max(10, ((pending.start + pending.end) / 2 / duration) * 100))}%` }}
          >
            <span className="whitespace-nowrap font-mono text-[12px] text-ink">
              สร้าง clip จากช่วงนี้ {fmtTime(pending.start)} – {fmtTime(pending.end)}
            </span>
            <button
              type="button"
              onClick={() => {
                onCreateRange(pending.start, pending.end)
                setPending(null)
              }}
              className="rounded-md bg-accent px-2.5 py-1 text-[12px] font-semibold text-[#1a120b] transition-[filter] hover:brightness-110"
            >
              สร้าง
            </button>
            <button
              type="button"
              onClick={() => setPending(null)}
              className="rounded-md border border-line3 px-2 py-1 text-[12px] text-muted hover:text-ink"
            >
              ✕
            </button>
          </div>
        )}
      </div>
      <div className="flex justify-between font-mono text-[10.5px] text-faint">
        <span>0:00:00</span>
        <span>{fmtTime(duration)}</span>
      </div>
    </div>
  )
}
