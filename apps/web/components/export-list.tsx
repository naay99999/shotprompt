'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, API_BASE } from '@/lib/api'
import { ASPECT_LABEL, fmtTime, type Aspect } from '@/lib/format'
import { useEvents } from '@/lib/use-events'
import type { Clip } from '@/components/clip-strip'

type ExportRow = {
  id: string
  clipId: string
  aspect: Aspect
  burnSubtitles: boolean
  status: 'queued' | 'rendering' | 'done' | 'failed'
  path: string | null
  error: string | null
  createdAt: number
}

export function ExportList({
  videoId,
  clips,
  refreshKey,
}: {
  videoId: string
  clips: Clip[]
  refreshKey: number
}) {
  const [rows, setRows] = useState<ExportRow[]>([])
  const [deleting, setDeleting] = useState<Record<string, boolean>>({})

  const refetch = useCallback(() => {
    api.videos({ id: videoId }).exports.get().then(r => {
      if (r.data) setRows(r.data as ExportRow[])
    })
  }, [videoId])

  useEffect(() => {
    refetch()
  }, [refetch, refreshKey])

  useEvents(e => {
    if (e.type === '$reconnect') {
      refetch()
      return
    }
    if (e.type === 'export:update' && e.videoId === videoId) refetch()
  })

  async function remove(id: string) {
    setDeleting(prev => ({ ...prev, [id]: true }))
    try {
      const { error } = await api.exports({ id }).delete()
      if (error) return
      setRows(prev => prev.filter(r => r.id !== id))
    } finally {
      setDeleting(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }

  if (rows.length === 0) return null

  const clipById = new Map(clips.map(c => [c.id, c]))

  return (
    <div className="flex flex-none flex-col gap-2">
      {rows.map(ex => {
        const clip = clipById.get(ex.clipId)
        const busy = ex.status === 'queued' || ex.status === 'rendering'
        const done = ex.status === 'done'
        const failed = ex.status === 'failed'
        const detail = `${ASPECT_LABEL[ex.aspect]}${ex.burnSubtitles ? ' · ฝัง subtitle' : ''} · loudnorm 2-pass`
        const barColor = done ? 'bg-ok' : failed ? 'bg-err' : 'bg-accent'
        return (
          <div
            key={ex.id}
            className="group flex items-center gap-3.5 rounded-[11px] border border-line bg-surface px-4 py-2.5"
          >
            {done && (
              <div className="flex h-[22px] w-[22px] flex-none animate-[pop_.4s_ease] items-center justify-center rounded-full bg-ok text-[11px] font-bold text-[#0f1c13]">
                ✓
              </div>
            )}
            {ex.status === 'rendering' && (
              <div className="h-5 w-5 flex-none animate-spin rounded-full border-[2.5px] border-accent/25 border-t-accent" />
            )}
            {ex.status === 'queued' && <div className="h-5 w-5 flex-none rounded-full border-[1.5px] border-line3" />}
            {failed && (
              <div className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-err/15 text-[11px] font-bold text-err">
                ✕
              </div>
            )}

            <div className="flex-none font-mono text-[13px]">คลิป {clip ? fmtTime(clip.start) : '--:--:--'}</div>
            <div
              className="min-w-0 flex-1 truncate text-[12px] text-dim"
              title={failed ? (ex.error ?? undefined) : undefined}
            >
              {failed ? (ex.error ?? 'export ล้มเหลว') : detail}
            </div>

            <div className="h-[5px] w-24 flex-none overflow-hidden rounded-full bg-line">
              {ex.status === 'rendering' ? (
                <div
                  className={`h-full w-2/5 rounded-full ${barColor}`}
                  style={{
                    backgroundImage:
                      'repeating-linear-gradient(45deg, rgba(0,0,0,.25) 0 6px, transparent 6px 12px)',
                    backgroundSize: '24px 24px',
                    animation: 'stripe 0.8s linear infinite',
                  }}
                />
              ) : (
                <div className={`h-full rounded-full ${barColor}`} style={{ width: done ? '100%' : failed ? '100%' : '0%' }} />
              )}
            </div>

            {done && (
              <a
                href={`${API_BASE}/exports/${ex.id}/download`}
                className="flex-none rounded-lg bg-accent/[.15] px-3.5 py-1.5 text-[12.5px] font-semibold text-accent transition-colors hover:bg-accent/25"
              >
                ↓ ดาวน์โหลด
              </a>
            )}
            {busy && <div className="flex-none font-mono text-[12px] text-accent">{ex.status === 'queued' ? 'รอคิว…' : 'กำลังแปลง…'}</div>}

            {/* Deleting a queued/rendering export races the in-flight job (which reads
                its row by id) — only allow removing exports that are no longer busy. */}
            {!busy && (
              <button
                type="button"
                onClick={() => remove(ex.id)}
                disabled={deleting[ex.id]}
                className="flex-none rounded-lg border border-line3 px-2.5 py-1.5 text-[12px] text-dim opacity-0 transition-opacity hover:border-err/40 hover:text-err group-hover:opacity-100 disabled:opacity-50"
              >
                ลบ
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
