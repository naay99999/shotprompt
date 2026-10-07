'use client'

import { useCallback, useEffect, useState } from 'react'
import { AppShell } from '@/components/app-shell'
import { UploadZone } from '@/components/upload-zone'
import { VideoRow, type LiveStep, type Video } from '@/components/video-row'
import { ErrorNotice } from '@/components/ui-feedback'
import { PRIVACY_COPY } from '@/lib/ui-copy'
import { checkResponse } from '@/lib/ui-error'
import { api } from '@/lib/api'
import { useEvents } from '@/lib/use-events'

export default function Home() {
  const [error, setError] = useState<unknown>(null)
  const [videos, setVideos] = useState<Video[] | null>(null)
  const [liveSteps, setLiveSteps] = useState<Record<string, LiveStep>>({})

  const refetch = useCallback(() => {
    setError(null)
    api.videos.get().then(response => {
      checkResponse(response)
      if (response.data) setVideos(response.data as Video[])
    }).catch(setError)
  }, [])

  useEffect(() => {
    refetch()
  }, [refetch])

  useEvents(e => {
    if (e.type === 'video:update' || e.type === 'job:update' || e.type === '$reconnect') {
      refetch()
    }
    if (e.type === 'step:update' && typeof e.videoId === 'string') {
      setLiveSteps(prev => ({
        ...prev,
        [e.videoId as string]: {
          name: e.name as string,
          status: e.status as string,
          progress: e.progress as number | undefined,
        },
      }))
    }
  })

  return (
    <AppShell active="library">
      <div className="sp-page flex flex-col gap-9">
        <div className="grid min-w-0 items-start gap-7 lg:grid-cols-[0.8fr_1.2fr] lg:gap-12">
          <header data-motion-intro className="min-w-0 pt-1 lg:pt-5">
            <h1 className="sp-heading max-w-5xl">คลังวิดีโอ</h1>
            <p className="sp-description mt-4 max-w-sm">เริ่มจากวิดีโอของคุณ แล้วเลือกช่วงที่อยากเล่า</p>
            <p className="mt-5 max-w-sm text-[13px] leading-relaxed text-dim">{PRIVACY_COPY}</p>
          </header>
          <UploadZone onUploaded={refetch} />
        </div>

        <section aria-labelledby="library-title" className="min-w-0">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-4">
            <h2 id="library-title" className="sp-section-title">วิดีโอของคุณ</h2>
            <p className="text-[13px] tabular-nums text-dim">{videos ? `${videos.length} วิดีโอ` : 'กำลังโหลด'}</p>
          </div>
          <ErrorNotice error={error} onRetry={refetch} />
          {!videos && !error && <div role="status" className="space-y-3"><p className="text-[13px] text-muted">กำลังโหลดวิดีโอ…</p>{[0, 1, 2].map(index => <div key={index} aria-hidden="true" className="sp-skeleton h-20 rounded-lg" />)}</div>}
          {videos?.length === 0 && <div className="sp-empty py-10 text-left"><h3 className="text-lg font-medium">พื้นที่สำหรับคลิปแรกของคุณ</h3><p className="mt-2 max-w-xl text-[14px] leading-relaxed text-muted">เพิ่มวิดีโอด้านบนเพื่อเริ่มถอดเสียง เมื่อประมวลผลเสร็จคุณจะเลือกช่วงและตัดต่อคลิปได้</p></div>}
          <div className="flex min-w-0 flex-col gap-2">
            {(videos ?? []).map(v => (
              <VideoRow key={v.id} video={v} liveStep={liveSteps[v.id]} onChanged={refetch} />
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  )
}
