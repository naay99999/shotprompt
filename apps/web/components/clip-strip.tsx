'use client'

import type { ClipAssessmentSnapshot } from '@shotprompt/core'
import { API_BASE } from '@/lib/api'
import { fmtTime } from '@/lib/format'

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

const GRADIENTS = [
  'linear-gradient(135deg,#3a2c22,#241d18)',
  'linear-gradient(135deg,#28302c,#1b201d)',
  'linear-gradient(135deg,#33272b,#211a1c)',
  'linear-gradient(135deg,#2f2b22,#1f1c17)',
]

function gradientFor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return GRADIENTS[h % GRADIENTS.length]
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
      <h2 className="font-semibold">คลิปของฉัน ({clips.length})</h2>
      <p className="text-[12px] text-muted">เปิดคลิปเพื่อแก้ไข และเลือกช่องทำเครื่องหมายสำหรับคลิปที่ต้องการส่งออก</p>
      {clips.length === 0 && <p className="rounded-xl border border-dashed border-line3 p-5 text-[14px] text-muted">ยังไม่มีคลิป เลือก “เพิ่มเป็นคลิป” จากช่วงแนะนำ หรือกำหนดเวลาเองในแถบเวลา</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{clips.map(clip => (
        <article key={clip.id} className={`min-w-0 rounded-xl border bg-surface p-3 ${selectedClipId === clip.id ? 'border-accent' : 'border-line3'}`}>
          <button type="button" aria-pressed={selectedClipId === clip.id} onClick={() => onSelect(clip.id)} className="w-full rounded-lg text-left">
            <span className="relative mb-2 block h-24 overflow-hidden rounded-lg" style={{ background: gradientFor(clip.id) }}>
              {clip.candidateId && <img src={`${API_BASE}/videos/${videoId}/thumb/${clip.candidateId}.jpg`} alt="" className="h-full w-full object-cover" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} />}
            </span>
            <span className="block text-[14px]">แก้ไขคลิป {fmtTime(clip.start)} – {fmtTime(clip.end)}</span>
            <span className="text-[12px] text-muted">ความยาว {Math.round(clip.end - clip.start)} วินาที</span>
          </button>
          <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 text-[14px]"><input type="checkbox" checked={!!exportSel[clip.id]} onChange={() => onToggleExport(clip.id)} />เลือกส่งออกคลิปนี้</label>
        </article>
      ))}</div>
    </section>
  )
}
