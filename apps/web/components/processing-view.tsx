'use client'

import { useState } from 'react'
import { fmtTime } from '@/lib/format'
import { useEvents } from '@/lib/use-events'
import { PIPELINE_STEP_META } from '@/lib/pipeline-steps'

export type JobStep = {
  id: number
  jobId: string
  name: string
  status: string
  error: string | null
  startedAt: number | null
  completedAt: number | null
}

export type Job = {
  id: string
  videoId: string
  type: string
  status: string
  error: string | null
  createdAt: number
  startedAt: number | null
  completedAt: number | null
  steps: JobStep[]
}

type TranscriptEntry = { time: number; text: string }

export function ProcessingView({
  videoId,
  duration,
  job,
}: {
  videoId: string
  duration: number | null
  job: Job | null
}) {
  const [progress, setProgress] = useState<{ pct: number; time: number } | null>(null)
  const [feed, setFeed] = useState<TranscriptEntry[]>([])

  useEvents(e => {
    if (e.type !== 'step:update' || e.videoId !== videoId || e.name !== 'transcribe') return
    if (typeof e.progress === 'number') setProgress({ pct: e.progress as number, time: (e.time as number) ?? 0 })
    if (typeof e.text === 'string') {
      const entry = { time: (e.time as number) ?? 0, text: e.text as string }
      setFeed(prev => [...prev, entry].slice(-3))
    }
  })

  const stepsByName = new Map(job?.steps.map(s => [s.name, s]) ?? [])

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[620px] flex-col gap-[18px] px-6 pt-11 pb-20">
        <div className="mb-1.5 text-center">
          <div className="text-[19px] font-bold">กำลังประมวลผลวิดีโอ</div>
          <div className="mt-1 text-[13px] text-muted">
            ปิดหน้านี้ได้เลย งานรันต่อเบื้องหลัง — กลับมาดูเมื่อไหร่ก็ได้
          </div>
        </div>

        <div className="flex flex-col gap-0.5 rounded-[15px] border border-line bg-surface p-2">
          {PIPELINE_STEP_META.map(step => {
            const row = stepsByName.get(step.name)
            const status = row?.status ?? 'pending'
            const isRunning = status === 'running'
            const isDone = status === 'done'
            const isFailed = status === 'failed'
            const isTranscribe = step.name === 'transcribe'

            return (
              <div key={step.name} className="flex items-start gap-3.5 rounded-[10px] px-3.5 py-3.5">
                {isDone && (
                  <div className="flex h-[26px] w-[26px] flex-none animate-[pop_.35s_ease] items-center justify-center rounded-full bg-accent text-[12px] font-bold text-[#1a120b]">
                    ✓
                  </div>
                )}
                {isRunning && (
                  <div className="h-[26px] w-[26px] flex-none animate-spin rounded-full border-[2.5px] border-accent/25 border-t-accent" />
                )}
                {isFailed && (
                  <div className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-err/15 text-[12px] font-bold text-err">
                    ✕
                  </div>
                )}
                {status === 'pending' && (
                  <div className="h-[26px] w-[26px] flex-none rounded-full border-[1.5px] border-line3" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between">
                    <div
                      className={`text-[14px] font-semibold ${
                        status === 'pending' ? 'text-dim' : isFailed ? 'text-err' : 'text-ink'
                      }`}
                    >
                      {step.label}
                    </div>
                  </div>
                  <div className="mt-px text-[12px] text-faint">
                    {isFailed && row?.error ? row.error : step.desc}
                  </div>
                  {isRunning && isTranscribe && (
                    <div className="mt-2.5">
                      <div className="h-[5px] overflow-hidden rounded-full bg-line">
                        <div
                          className="h-full rounded-full bg-accent transition-[width] duration-[400ms]"
                          style={{ width: `${Math.round((progress?.pct ?? 0) * 100)}%` }}
                        />
                      </div>
                      <div className="mt-[7px] font-mono text-[11.5px] text-dim">
                        {Math.round((progress?.pct ?? 0) * 100)}% · segment ล่าสุด {fmtTime(progress?.time ?? 0)}
                        {duration ? ` / ${fmtTime(duration)}` : ''} · resume ได้ถ้าหลุด
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {feed.length > 0 && (
          <div className="flex flex-col gap-2 px-1.5">
            <div className="text-[11.5px] font-semibold tracking-[.4px] text-faint">ถอดเสียงล่าสุด</div>
            {feed.map((f, i) => (
              <div key={i} className="flex animate-[fadeUp_.35s_ease] gap-3">
                <span className="flex-none pt-0.5 font-mono text-[11.5px] text-faint">{fmtTime(f.time)}</span>
                <span className="text-[13.5px] text-muted">{f.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
