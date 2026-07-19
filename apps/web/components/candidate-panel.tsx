'use client'

import { useState } from 'react'
import { api, API_BASE } from '@/lib/api'
import { fmtTime } from '@/lib/format'

export type Candidate = { id: string; videoId: string; start: number; end: number; score: number; thumbnailPath: string | null }
export type ClipRef = { id: string; candidateId: string | null }

function scoreStyle(score: number) {
  if (score >= 70) return { background: 'rgba(232,130,63,.15)', color: '#e8823f' }
  if (score >= 50) return { background: 'rgba(217,161,63,.15)', color: '#d9a13f' }
  return { background: 'rgba(122,116,109,.18)', color: '#a29c92' }
}

export function CandidatePanel({
  videoId,
  candidates,
  clips,
  onSeek,
  onAccepted,
}: {
  videoId: string
  candidates: Candidate[]
  clips: ClipRef[]
  onSeek: (t: number) => void
  onAccepted: () => void
}) {
  const [accepting, setAccepting] = useState<Record<string, boolean>>({})
  const acceptedCandidateIds = new Set(clips.map(c => c.candidateId).filter((id): id is string => !!id))

  async function accept(candidateId: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (accepting[candidateId] || acceptedCandidateIds.has(candidateId)) return
    setAccepting(prev => ({ ...prev, [candidateId]: true }))
    await api.videos({ id: videoId }).clips.post({ candidateId })
    setAccepting(prev => ({ ...prev, [candidateId]: false }))
    onAccepted()
  }

  return (
    <div className="flex min-h-0 w-[360px] flex-none flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-baseline justify-between border-b border-line px-[18px] py-4">
        <div className="text-[14.5px] font-bold">Candidates</div>
        <div className="text-[12px] text-dim">{candidates.length} ช่วงที่น่าตัด · เรียงตามคะแนน</div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {candidates.length === 0 && (
          <div className="px-3 py-6 text-center text-[12.5px] text-faint">ยังไม่พบช่วงที่น่าตัด</div>
        )}
        {candidates.map((c, i) => {
          const accepted = acceptedCandidateIds.has(c.id)
          const pill = scoreStyle(c.score)
          return (
            <div
              key={c.id}
              onClick={() => onSeek(c.start)}
              className={`flex cursor-pointer items-center gap-2.5 rounded-[10px] p-2.5 transition-colors hover:bg-line2/60 ${accepted ? 'opacity-55' : ''}`}
            >
              <div className="w-4 flex-none font-mono text-[11px] text-faint">#{i + 1}</div>
              <div className="relative h-11 w-[78px] flex-none overflow-hidden rounded-[7px] bg-line2">
                <img
                  src={`${API_BASE}/videos/${videoId}/thumb/${c.id}.jpg`}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={e => {
                    ;(e.target as HTMLImageElement).style.display = 'none'
                  }}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[12.5px]">
                  {fmtTime(c.start)} – {fmtTime(c.end)}
                </div>
                <div className="mt-0.5 text-[11.5px] text-dim">{fmtTime(c.end - c.start)}</div>
              </div>
              <div
                className="flex-none rounded-full px-2.5 py-[3px] font-mono text-[12px] font-bold"
                style={pill}
              >
                {Math.round(c.score)}
              </div>
              {accepted ? (
                <div className="flex h-[27px] w-[27px] flex-none animate-[pop_.3s_ease] items-center justify-center rounded-lg bg-ok/15 text-[12px] text-ok">
                  ✓
                </div>
              ) : (
                <button
                  type="button"
                  title="รับเป็นคลิป"
                  disabled={accepting[c.id]}
                  onClick={e => accept(c.id, e)}
                  className="flex h-[27px] w-[27px] flex-none items-center justify-center rounded-lg border border-line3 text-[14px] leading-none text-[#c9c4bb] transition-colors hover:border-accent hover:bg-accent/10 hover:text-accent disabled:opacity-40"
                >
                  {accepting[c.id] ? '…' : '＋'}
                </button>
              )}
            </div>
          )
        })}
      </div>
      <div className="border-t border-line px-[18px] py-3 text-[11.5px] text-faint">
        ลากช่วงเวลาบน timeline เพื่อสร้างคลิปเองก็ได้
      </div>
    </div>
  )
}
