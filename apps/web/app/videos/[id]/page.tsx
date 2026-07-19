'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppShell } from '@/components/app-shell'
import { CandidatePanel, type Candidate, type ClipRef } from '@/components/candidate-panel'
import { ClipStrip, type Clip } from '@/components/clip-strip'
import { ProcessingView, type Job } from '@/components/processing-view'
import { Timeline } from '@/components/timeline'
import { api, API_BASE } from '@/lib/api'
import { fmtTime } from '@/lib/format'
import { useEvents } from '@/lib/use-events'

type Video = {
  id: string
  filename: string
  path: string
  duration: number | null
  width: number | null
  height: number | null
  status: 'uploaded' | 'processing' | 'ready' | 'failed'
  language: 'th' | 'en'
  createdAt: number
}

type VideoResp = { video: Video; job: Job | null; candidateCount: number }

export default function WorkspacePage() {
  const { id } = useParams<{ id: string }>()

  const [resp, setResp] = useState<VideoResp | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [clips, setClips] = useState<Clip[]>([])
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [exportSel, setExportSel] = useState<Record<string, boolean>>({})
  const [currentTime, setCurrentTime] = useState(0)
  const [canceling, setCanceling] = useState(false)
  const [retrying, setRetrying] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)

  const refetchAll = useCallback(() => {
    Promise.all([
      api.videos({ id }).get(),
      api.videos({ id }).candidates.get(),
      api.videos({ id }).clips.get(),
    ]).then(([v, c, cl]) => {
      if (v.data) setResp(v.data as VideoResp)
      else if (v.error) setNotFound(true)
      if (c.data) setCandidates(c.data as Candidate[])
      if (cl.data) setClips(cl.data as Clip[])
    })
  }, [id])

  useEffect(() => {
    refetchAll()
  }, [refetchAll])

  useEvents(e => {
    if (e.type === '$reconnect') {
      refetchAll()
      return
    }
    if ((e.type === 'video:update' || e.type === 'job:update' || e.type === 'step:update') && e.videoId === id) {
      refetchAll()
    }
  })

  function seek(t: number) {
    setCurrentTime(t)
    if (videoRef.current) videoRef.current.currentTime = t
  }

  async function createRange(start: number, end: number) {
    await api.videos({ id }).clips.post({ start, end })
    refetchAll()
  }

  async function cancelJob() {
    if (!resp?.job || canceling) return
    setCanceling(true)
    await api.jobs({ id: resp.job.id }).cancel.post()
    setCanceling(false)
    refetchAll()
  }

  async function retry() {
    if (retrying) return
    setRetrying(true)
    await api.videos({ id }).retry.post()
    setRetrying(false)
    refetchAll()
  }

  function toggleExport(clipId: string) {
    setExportSel(prev => ({ ...prev, [clipId]: !prev[clipId] }))
  }

  if (notFound) {
    return (
      <AppShell active="library">
        <div className="flex flex-col items-center gap-3 px-8 py-20 text-center">
          <div className="text-[15px] font-semibold">ไม่พบวิดีโอนี้</div>
          <Link href="/" className="text-[13px] text-accent hover:underline">
            ← กลับไปคลังวิดีโอ
          </Link>
        </div>
      </AppShell>
    )
  }

  if (!resp) {
    return (
      <AppShell active="library">
        <div className="px-8 py-20 text-center text-[13px] text-muted">กำลังโหลด…</div>
      </AppShell>
    )
  }

  const { video, job } = resp
  const isProcessing = video.status === 'uploaded' || video.status === 'processing'
  const isFailed = video.status === 'failed'
  const isReady = video.status === 'ready'
  const duration = video.duration ?? 0

  return (
    <AppShell active="library">
      <div className="flex h-[calc(100vh-54px)] flex-col">
        <div className="flex flex-none items-center gap-3.5 border-b border-line px-[22px] py-3">
          <Link
            href="/"
            className="rounded-lg px-3 py-1.5 text-[13px] text-muted transition-colors hover:bg-line2 hover:text-ink"
          >
            ← คลังวิดีโอ
          </Link>
          <div className="h-[18px] w-px bg-line2" />
          <div className="truncate text-[14.5px] font-semibold">{video.filename}</div>
          <div className="font-mono text-[12px] text-faint">{video.duration ? fmtTime(video.duration) : '--:--:--'}</div>
          <div className="flex-1" />
          {isProcessing && (
            <button
              type="button"
              onClick={cancelJob}
              disabled={canceling || !job}
              className="rounded-lg border border-err/35 px-3.5 py-[7px] text-[12.5px] text-err transition-colors hover:bg-err/10 disabled:opacity-50"
            >
              {canceling ? 'กำลังยกเลิก…' : 'ยกเลิกงาน'}
            </button>
          )}
        </div>

        {isProcessing && <ProcessingView videoId={id} duration={video.duration} job={job} />}

        {isFailed && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3.5 px-8 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-err/15 text-[18px] text-err">✕</div>
            <div className="text-[15px] font-semibold">ประมวลผลล้มเหลว</div>
            {job?.error && <div className="max-w-[520px] text-[12.5px] text-dim">{job.error}</div>}
            <button
              type="button"
              onClick={retry}
              disabled={retrying}
              className="mt-1.5 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-[#1a120b] transition-[filter] hover:brightness-110 disabled:opacity-50"
            >
              {retrying ? 'กำลังลองใหม่…' : 'ลองใหม่'}
            </button>
          </div>
        )}

        {isReady && (
          <div className="flex min-h-0 flex-1 gap-[18px] px-[22px] py-[18px]">
            <div className="flex min-w-0 flex-1 flex-col gap-3.5 overflow-y-auto pr-0.5">
              <div className="relative flex-none overflow-hidden rounded-2xl bg-black">
                <video
                  ref={videoRef}
                  src={`${API_BASE}/videos/${id}/stream`}
                  controls
                  className="aspect-video w-full bg-black"
                  onTimeUpdate={e => setCurrentTime(e.currentTarget.currentTime)}
                  onLoadedMetadata={e => setCurrentTime(e.currentTarget.currentTime)}
                />
                <div className="pointer-events-none absolute top-2.5 left-3 font-mono text-[11px] text-[#c9c4bb]">
                  source.mp4 · {video.width ?? '?'}×{video.height ?? '?'} · {fmtTime(currentTime)}
                </div>
              </div>

              <Timeline
                duration={duration}
                currentTime={currentTime}
                candidates={candidates}
                onSeek={seek}
                onCreateRange={createRange}
              />

              <ClipStrip
                videoId={id}
                clips={clips}
                selectedClipId={selectedClipId}
                exportSel={exportSel}
                onSelect={cid => setSelectedClipId(cid)}
                onToggleExport={toggleExport}
              />
            </div>

            {selectedClipId === null ? (
              <CandidatePanel
                videoId={id}
                candidates={candidates}
                clips={clips as ClipRef[]}
                onSeek={seek}
                onAccepted={refetchAll}
              />
            ) : (
              <div className="flex w-[360px] flex-none flex-col overflow-hidden rounded-2xl border border-line bg-surface">
                <div className="flex items-center justify-between border-b border-line px-[18px] py-3.5">
                  <div className="text-[14.5px] font-bold">แก้ไขคลิป</div>
                  <button
                    type="button"
                    onClick={() => setSelectedClipId(null)}
                    className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] text-[13px] text-dim transition-colors hover:bg-line2 hover:text-ink"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex flex-1 items-center justify-center px-6 text-center text-[12.5px] text-faint">
                  ตัวแก้ไขคลิป (trim, crop, subtitle) มาใน task ถัดไป
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  )
}
