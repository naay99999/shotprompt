'use client'

import Link from 'next/link'
import { useState } from 'react'
import { describeError } from '@/lib/ui-error'
import { api } from '@/lib/api'
import { WhisperModelDialog } from '@/components/whisper-model-dialog'
import type { WhisperModel } from '@/lib/whisper-options'
import { fmtTime } from '@/lib/format'

export type Video = {
  id: string
  filename: string
  path: string
  duration: number | null
  width: number | null
  height: number | null
  status: 'uploaded' | 'processing' | 'ready' | 'failed'
  language: string
  languageName: string
  whisperModel: string | null
  createdAt: number
  clipCount: number
}

export type LiveStep = { name: string; status: string; progress?: number }

const STEP_LABELS: Record<string, string> = {
  normalize: 'ปรับวิดีโอ',
  'extract-audio': 'แยกเสียง',
  transcribe: 'ถอดเสียง',
  'detect-scenes': 'ตรวจจับฉาก',
  'detect-hooks': 'หาช่วงเด่น',
  thumbnails: 'สร้างภาพย่อ',
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

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
}

export function VideoRow({
  video,
  liveStep,
  onChanged,
}: {
  video: Video
  liveStep?: LiveStep
  onChanged?: () => void
}) {
  const [retrying, setRetrying] = useState(false)
  const [selectingModel, setSelectingModel] = useState(false)

  const isReady = video.status === 'ready'
  const isFailed = video.status === 'failed'
  const isProcessing = !isReady && !isFailed

  let chipText = 'พร้อมใช้งาน'
  if (isFailed) {
    chipText = 'ทำงานไม่สำเร็จ'
  } else if (isProcessing) {
    if (liveStep?.name === 'transcribe' && typeof liveStep.progress === 'number') {
      chipText = `ถอดเสียง ${Math.round(liveStep.progress * 100)}%`
    } else if (liveStep?.name) {
      chipText = STEP_LABELS[liveStep.name] ?? liveStep.name
    } else {
      chipText = 'กำลังประมวลผล'
    }
  }

  const metaParts = [
    video.duration ? fmtTime(video.duration) : '—',
    video.languageName,
    fmtDate(video.createdAt),
  ]
  const meta = metaParts.join(' · ') + (isFailed ? ' · ลองถอดเสียงใหม่ได้' : '')

  function retry(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (retrying || selectingModel) return
    setSelectingModel(true)
  }

  async function startRetry(model: WhisperModel) {
    setRetrying(true)
    try {
      const { error } = await api.videos({ id: video.id }).retry.post({ model })
      if (error) {
        const value = error.value as { message?: string } | undefined
        return describeError(error).message
      }
      onChanged?.()
      return null
    } catch {
      return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'
    } finally {
      setRetrying(false)
    }
  }

  const inner = (
    <div className="flex flex-wrap items-center gap-3 rounded-[13px] border border-line bg-surface px-4 py-3.5 transition-colors hover:border-line3 hover:bg-line2/30">
      <div
        className="relative h-[54px] w-[88px] flex-none overflow-hidden rounded-lg"
        style={{ background: gradientFor(video.id) }}
      >
        <div className="absolute right-[5px] bottom-[5px] rounded-[5px] bg-black/65 px-1.5 py-px font-mono text-[12px] text-[#c9c4bb]">
          {video.duration ? fmtTime(video.duration) : '--:--:--'}
        </div>
      </div>
      <div className="min-w-[120px] flex-1">
        <div className="truncate text-[14.5px] font-semibold">{video.filename}</div>
        <div className="mt-[3px] truncate text-[14px] text-dim">{meta}</div>
      </div>
      <div className="flex-none text-[14px] text-dim">
        {video.clipCount > 0 ? `${video.clipCount} คลิป` : '—'}
      </div>
      <div
        className={`flex flex-none items-center gap-[7px] rounded-full px-3 py-[5px] text-[14px] font-medium ${
          isReady ? 'bg-ok/15 text-ok' : isFailed ? 'bg-err/15 text-err' : 'bg-line2 text-muted'
        }`}
      >
        {isProcessing && (
          <span className="h-[11px] w-[11px] animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
        )}
        {isReady && <span className="text-[12px]">✓</span>}
        <span>{chipText}</span>
      </div>
      {isFailed && (
        <button
          type="button"
          onClick={retry}
          disabled={retrying}
          className="flex-none rounded-lg border border-line3 px-3.5 py-1.5 text-[14px] text-[#c9c4bb] transition-colors hover:border-[#4a4438] disabled:opacity-50"
        >
          {retrying ? '…' : 'ลองใหม่'}
        </button>
      )}
    </div>
  )

  if (isFailed) {
    return (
      <>
        {inner}
        {selectingModel && (
          <WhisperModelDialog
            savedModel={video.whisperModel}
            onCancel={() => setSelectingModel(false)}
            onStart={startRetry}
          />
        )}
      </>
    )
  }

  return (
    <Link href={`/videos/${video.id}`} className="block">
      {inner}
    </Link>
  )
}
