'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import type { Clip } from '@/components/clip-strip'

type Aspect = '9:16' | '16:9' | 'original'
const ASPECTS: { value: Aspect; label: string }[] = [
  { value: '9:16', label: '9:16' },
  { value: '16:9', label: '16:9' },
  { value: 'original', label: 'ต้นฉบับ' },
]

export function ExportBar({
  clips,
  exportSel,
  onExported,
}: {
  clips: Clip[]
  exportSel: Record<string, boolean>
  onExported: () => void
}) {
  const [aspect, setAspect] = useState<Aspect>('9:16')
  const [burnSubtitles, setBurnSubtitles] = useState(true)
  const [exporting, setExporting] = useState(false)

  const clipIds = new Set(clips.map(c => c.id))
  const selectedIds = Object.keys(exportSel).filter(id => exportSel[id] && clipIds.has(id))
  const selCount = selectedIds.length

  async function startExport() {
    if (selCount === 0 || exporting) return
    setExporting(true)
    await api.exports.post({ clipIds: selectedIds, aspect, burnSubtitles })
    setExporting(false)
    onExported()
  }

  return (
    <div className="flex flex-none flex-wrap items-center gap-4 rounded-xl border border-line bg-surface px-4 py-3">
      <div className="text-[13px] font-semibold">Export · เลือกแล้ว {selCount} คลิป</div>

      <div className="flex gap-0.5 rounded-[9px] border border-line2 bg-surface2 p-[3px]">
        {ASPECTS.map(a => (
          <button
            key={a.value}
            type="button"
            onClick={() => setAspect(a.value)}
            className={`rounded-[6px] px-3.5 py-1.5 text-[12.5px] transition-colors ${
              aspect === a.value ? 'bg-accent/[.16] text-accent' : 'text-dim hover:text-ink'
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setBurnSubtitles(v => !v)}
        className="flex items-center gap-2.5"
      >
        <div className={`relative h-5 w-[34px] rounded-full transition-colors ${burnSubtitles ? 'bg-accent' : 'bg-line3'}`}>
          <div
            className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-[left]"
            style={{ left: burnSubtitles ? 16 : 2 }}
          />
        </div>
        <span className="text-[12.5px] text-muted">ฝัง subtitle</span>
      </button>

      <div className="flex-1" />

      <button
        type="button"
        onClick={startExport}
        disabled={selCount === 0 || exporting}
        className="rounded-[9px] bg-accent px-5 py-[9px] text-[13.5px] font-semibold text-[#1a120b] transition-[filter,opacity] hover:brightness-110 disabled:opacity-40"
      >
        {exporting ? 'กำลังเริ่ม export…' : selCount ? `Export ${selCount} คลิป` : 'Export'}
      </button>
    </div>
  )
}
