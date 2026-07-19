'use client'

import { useCallback, useEffect, useState } from 'react'
import { AppShell } from '@/components/app-shell'
import { UploadZone } from '@/components/upload-zone'
import { VideoRow, type LiveStep, type Video } from '@/components/video-row'
import { api } from '@/lib/api'
import { useEvents } from '@/lib/use-events'

export default function Home() {
  const [videos, setVideos] = useState<Video[] | null>(null)
  const [liveSteps, setLiveSteps] = useState<Record<string, LiveStep>>({})

  const refetch = useCallback(() => {
    api.videos.get().then(({ data }) => {
      if (data) setVideos(data as Video[])
    })
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
      <div className="mx-auto flex max-w-[1020px] flex-col gap-7 px-8 py-11">
        <div>
          <div className="text-[25px] font-bold">คลังวิดีโอ</div>
          <div className="mt-1 text-[13.5px] text-muted">
            {videos ? `${videos.length} วิดีโอ · ` : ''}
            ทุกอย่างอยู่ในเครื่องของคุณ ไม่มีอะไรออกสู่อินเทอร์เน็ต
          </div>
        </div>

        <UploadZone onUploaded={refetch} />

        <div className="flex flex-col gap-2.5">
          {(videos ?? []).map(v => (
            <VideoRow key={v.id} video={v} liveStep={liveSteps[v.id]} onChanged={refetch} />
          ))}
        </div>
      </div>
    </AppShell>
  )
}
