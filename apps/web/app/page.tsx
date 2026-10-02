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
      <div className="mx-auto flex max-w-[1020px] flex-col gap-7 px-4 py-8 sm:px-8">
        <div>
          <h1 className="text-[25px] font-bold">คลังวิดีโอ</h1>
          <div className="mt-1 text-[14px] text-muted">
            {videos ? `${videos.length} วิดีโอ · ` : ''}
            {PRIVACY_COPY}
          </div>
        </div>

        <UploadZone onUploaded={refetch} />

        <div className="flex flex-col gap-2.5">
          <ErrorNotice error={error} onRetry={refetch} />
          {!videos && !error && <p role="status">กำลังโหลดวิดีโอ…</p>}
          {videos?.length === 0 && <div className="rounded-xl border border-dashed border-line3 p-6 text-center"><h2 className="font-semibold">เริ่มสร้างคลิปแรกของคุณ</h2><p className="mt-2 text-muted">เพิ่มวิดีโอด้านบน ระบบจะถอดเสียงและแนะนำช่วงที่น่าสนใจให้เลือกเป็นคลิป</p></div>}
          {(videos ?? []).map(v => (
            <VideoRow key={v.id} video={v} liveStep={liveSteps[v.id]} onChanged={refetch} />
          ))}
        </div>
      </div>
    </AppShell>
  )
}
