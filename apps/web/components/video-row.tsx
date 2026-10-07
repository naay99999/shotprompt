'use client'

import Link from 'next/link'
import { ArrowRight, CheckCircle, FilmSlate, WarningCircle } from '@phosphor-icons/react'
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
    <div className="group grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 rounded-lg border border-transparent bg-surface px-4 py-4 transition-colors hover:border-line3 hover:bg-surface2 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto]">
      <div data-motion-image aria-hidden="true" className="row-span-2 flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md border border-line bg-bg text-dim sm:row-span-1">
        <FilmSlate size={28} weight="light" className="transition-transform duration-300 group-hover:scale-110 motion-reduce:transition-none" />
      </div>
      <div className="col-span-2 min-w-0 sm:col-span-1">
        <div title={video.filename} className="line-clamp-2 break-all text-[14px] font-medium leading-relaxed sm:truncate">{video.filename}</div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] leading-relaxed tabular-nums text-dim"><span>{meta}</span>{video.clipCount > 0 && <span className="text-muted">{video.clipCount} คลิป</span>}</div>
      </div>
      <div className="col-span-2 col-start-2 flex flex-wrap items-center gap-3 sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:justify-end">
      <div
        className={`flex items-center gap-2 text-[12px] font-medium ${
          isReady ? 'text-ok' : isFailed ? 'text-err' : 'text-muted'
        }`}
      >
        {isProcessing && (
          <span aria-hidden="true" className="h-3 w-3 animate-spin rounded-full border-2 border-accent/30 border-t-accent motion-reduce:animate-none" />
        )}
        {isReady && <CheckCircle size={16} weight="fill" aria-hidden="true" />}
        {isFailed && <WarningCircle size={16} aria-hidden="true" />}
        <span>{chipText}</span>
      </div>
      {isFailed && (
        <button
          type="button"
          onClick={retry}
          disabled={retrying}
          className="sp-button sp-button-quiet text-[12px]"
        >
          {retrying ? '…' : 'ลองใหม่'}
        </button>
      )}
      {!isFailed && <ArrowRight size={18} aria-hidden="true" className="hidden text-dim transition-transform group-hover:translate-x-1 motion-reduce:transition-none sm:block" />}
      </div>
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
