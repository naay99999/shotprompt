'use client'

import type { ClipAssessmentSnapshot } from '@shotprompt/core'
import { API_BASE } from '@/lib/api'
import { fmtTime } from '@/lib/format'
import { Scissors } from '@phosphor-icons/react'

export type Clip = {
  id: string
  videoId: string
  candidateId: string | null
  start: number
  end: number
  score: number | null
  assessment?: ClipAssessmentSnapshot | null
  cropOffset: number
  thumbnailPath: string | null
  createdAt: number
}

export function ClipStrip({
  videoId,
  clips,
  selectedClipId,
  exportSel,
  onSelect,
  onToggleExport,
}: {
  videoId: string
  clips: Clip[]
  selectedClipId: string | null
  exportSel: Record<string, boolean>
  onSelect: (id: string) => void
  onToggleExport: (id: string) => void
}) {
  return (
    <section aria-label="คลิปของฉัน" className="space-y-3">
      <div className="flex items-center justify-between gap-2"><h2 className="sp-section-title">คลิปของฉัน</h2><span className="text-[12px] text-muted tabular-nums">{clips.length} คลิป</span></div>
      <p className="text-[12px] text-muted">เลือกคลิปเพื่อแก้ไข หรือทำเครื่องหมายเพื่อส่งออกหลายคลิป</p>
      {clips.length === 0 && <div className="sp-empty"><Scissors size={28} aria-hidden="true" className="mx-auto mb-3 text-accent" /><p className="font-medium text-ink">สร้างคลิปแรกของคุณ</p><p className="mt-2 text-[13px]">ลากเลือกช่วงบน timeline หรือเลือกจาก AI แนะนำ</p></div>}
      <div className="space-y-2">{clips.map((clip, index) => (
        <article key={clip.id} className="sp-clip-row" data-selected={selectedClipId === clip.id}>
          <button type="button" aria-pressed={selectedClipId === clip.id} onClick={() => onSelect(clip.id)} className="flex min-w-0 flex-1 items-center gap-2 rounded text-left">
            <span className="sp-clip-thumbnail" data-motion-image>
              {clip.candidateId ? <img src={`${API_BASE}/videos/${videoId}/thumb/${clip.candidateId}.jpg`} alt="" className="h-full w-full object-cover" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} /> : <Scissors size={18} aria-hidden="true" />}
            </span>
            <span className="min-w-0"><span className="block text-[13px] font-medium">คลิป {index + 1}</span><span className="block text-[11px] text-muted tabular-nums">{fmtTime(clip.start)} – {fmtTime(clip.end)}</span><span className="block text-[11px] text-muted">{Math.round(clip.end - clip.start)} วินาที</span></span>
          </button>
          <label className="flex min-h-11 items-center"><input aria-label={`เลือกคลิป ${index + 1} เพื่อส่งออก`} type="checkbox" checked={!!exportSel[clip.id]} onChange={() => onToggleExport(clip.id)} /></label>
        </article>
      ))}</div>
    </section>
  )
}
