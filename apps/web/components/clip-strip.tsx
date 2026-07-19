'use client'

import { API_BASE } from '@/lib/api'
import { fmtTime } from '@/lib/format'

export type Clip = {
  id: string
  videoId: string
  candidateId: string | null
  start: number
  end: number
  score: number | null
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
    <div className="flex flex-none flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <div className="text-[14px] font-bold">คลิปของฉัน</div>
        <div className="rounded-full bg-line2 px-2.5 py-0.5 text-[11.5px] text-muted">{clips.length}</div>
        <div className="flex-1" />
        <div className="text-[12px] text-faint">ติ๊กเลือกคลิปที่จะ export</div>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {clips.length === 0 && (
          <div className="rounded-xl border border-dashed border-line3 px-4 py-6 text-[12.5px] text-faint">
            ยังไม่มีคลิป — กด ＋ ที่ candidate หรือลากบน timeline เพื่อสร้างคลิปแรก
          </div>
        )}
        {clips.map(clip => {
          const selected = clip.id === selectedClipId
          const checked = !!exportSel[clip.id]
          const thumbSrc = clip.candidateId ? `${API_BASE}/videos/${videoId}/thumb/${clip.candidateId}.jpg` : null
          return (
            <div
              key={clip.id}
              onClick={() => onSelect(clip.id)}
              className={`w-[198px] flex-none cursor-pointer overflow-hidden rounded-xl border-[1.5px] bg-surface transition-[border-color,transform] hover:-translate-y-0.5 ${
                selected ? 'border-accent' : 'border-line'
              }`}
            >
              <div className="relative h-[86px]" style={{ background: gradientFor(clip.id) }}>
                {thumbSrc && (
                  <img
                    src={thumbSrc}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover"
                    onError={e => {
                      ;(e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                )}
                <div
                  onClick={e => {
                    e.stopPropagation()
                    onToggleExport(clip.id)
                  }}
                  className={`absolute top-2 left-2 flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border-[1.5px] text-[11px] font-bold text-[#1a120b] transition-colors ${
                    checked ? 'border-accent bg-accent' : 'border-white/40 bg-black/30'
                  }`}
                >
                  {checked ? '✓' : ''}
                </div>
                <div className="absolute right-1.5 bottom-1.5 rounded-[5px] bg-black/65 px-1.5 py-px font-mono text-[10.5px] text-[#c9c4bb]">
                  {fmtTime(clip.end - clip.start)}
                </div>
              </div>
              <div className="px-3 py-2.5">
                <div className="font-mono text-[12.5px]">
                  {fmtTime(clip.start)} – {fmtTime(clip.end)}
                </div>
                <div className="mt-0.5 text-[11.5px] text-dim">
                  {clip.score != null ? `คะแนน ${Math.round(clip.score)}` : 'คลิปที่สร้างเอง'}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
