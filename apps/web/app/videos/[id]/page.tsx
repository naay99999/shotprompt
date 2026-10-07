'use client'

import Link from 'next/link'
import { handleTabKeyDown } from '@/lib/tab-keyboard'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FullscreenButton,
  MediaPlayer,
  MediaProvider,
  MuteButton,
  PlayButton,
  useMediaRemote,
  useMediaState,
  type MediaPlayerInstance,
} from '@vidstack/react'
import { AppShell } from '@/components/app-shell'
import { CandidatePanel, type CandidateFilters, type ClipRef } from '@/components/candidate-panel'
import { ClipEditor } from '@/components/clip-editor'
import { ClipStrip, type Clip } from '@/components/clip-strip'
import { ExportBar } from '@/components/export-bar'
import { ExportList } from '@/components/export-list'
import { ProcessingView, type Job } from '@/components/processing-view'
import { Timeline } from '@/components/timeline'
import { WhisperModelDialog } from '@/components/whisper-model-dialog'
import { ErrorNotice, Help } from '@/components/ui-feedback'
import { useNavigationGuard } from '@/components/navigation-guard'
import { checkResponse } from '@/lib/ui-error'
import { transcriptionLabel } from '@/lib/ui-copy'
import { api, API_BASE } from '@/lib/api'
import { isTimeWithinPreviewRange, nextPreviewPosition, previewRangeForClip, type PreviewRange } from '@/lib/clip-preview'
import { fmtTime } from '@/lib/format'
import type { WhisperModel } from '@/lib/whisper-options'
import { useAnalysis } from '@/lib/use-analysis'
import { filterCandidates } from '@/lib/analysis-view'
import { useEvents } from '@/lib/use-events'
import { ArrowLeft, ArrowClockwise, DownloadSimple, Scissors, Sparkle, X, SlidersHorizontal } from '@phosphor-icons/react'
import { exportSelectionForWorkspace } from '@/lib/workspace-state'

type Video = {
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
}

type VideoResp = { video: Video; job: Job | null; candidateCount: number }

function PreviewIcon({ name }: { name: 'play' | 'pause' | 'volume' | 'mute' | 'fullscreen' | 'fullscreen-exit' }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, strokeWidth: 1.8 }

  if (name === 'play') {
    return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[17px] w-[17px] fill-current"><path d="M7 4.8c0-.8.9-1.3 1.6-.9l11.1 6.5a1.8 1.8 0 0 1 0 3.2L8.6 20.1c-.7.4-1.6-.1-1.6-.9V4.8Z" /></svg>
  }
  if (name === 'pause') {
    return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[17px] w-[17px] fill-current"><path d="M6.5 5.5h4v13h-4zm7 0h4v13h-4z" /></svg>
  }
  if (name === 'mute') {
    return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[17px] w-[17px]" {...common}><path d="M4 10v4h4l5 4V6l-5 4H4Z" /><path d="m17 9 5 6m0-6-5 6" /></svg>
  }
  if (name === 'volume') {
    return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[17px] w-[17px]" {...common}><path d="M4 10v4h4l5 4V6l-5 4H4Z" /><path d="M16 9a5 5 0 0 1 0 6m2.5-8.5a8.5 8.5 0 0 1 0 11" /></svg>
  }
  if (name === 'fullscreen-exit') {
    return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[17px] w-[17px]" {...common}><path d="M9 4v5H4m16 0h-5V4M4 15h5v5m6 0v-5h5" /></svg>
  }
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[17px] w-[17px]" {...common}><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" /></svg>
}

function PreviewControls({
  currentTime,
  duration,
  onSeek,
}: {
  currentTime: number
  duration: number
  onSeek: (time: number) => void
}) {
  const paused = useMediaState('paused')
  const muted = useMediaState('muted')
  const fullscreen = useMediaState('fullscreen')
  const volume = useMediaState('volume')
  const remote = useMediaRemote()

  return (
    <div
      data-visible={paused}
      className="media-controls pointer-events-auto absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-4 pt-9 pb-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 data-[visible=true]:opacity-100"
    >
      <input
        type="range"
        aria-label="ตำแหน่งวิดีโอ"
        min={0}
        max={duration || 1}
        step="any"
        value={Math.min(currentTime, duration || 0)}
        onChange={event => onSeek(Number(event.currentTarget.value))}
        className="mb-2 block h-1 w-full cursor-pointer accent-accent"
      />
      <div className="flex items-center gap-3 text-white">
        <PlayButton
          aria-label={paused ? 'เล่นวิดีโอ' : 'หยุดวิดีโอ'}
          className="flex h-8 w-8 flex-none items-center justify-center rounded-md transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-accent"
        >
          <PreviewIcon name={paused ? 'play' : 'pause'} />
        </PlayButton>
        <span className="min-w-[98px] font-mono text-[12px] tabular-nums text-white/85">
          {fmtTime(currentTime)} / {fmtTime(duration)}
        </span>
        <div className="flex-1" />
        <MuteButton
          aria-label={muted || volume === 0 ? 'เปิดเสียง' : 'ปิดเสียง'}
          className="flex h-8 w-8 flex-none items-center justify-center rounded-md transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-accent"
        >
          <PreviewIcon name={muted || volume === 0 ? 'mute' : 'volume'} />
        </MuteButton>
        <input
          type="range"
          aria-label="ระดับเสียง"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          onChange={event => remote.changeVolume(Number(event.currentTarget.value))}
          className="hidden h-1 w-[72px] cursor-pointer accent-accent sm:block"
        />
        <FullscreenButton
          aria-label={fullscreen ? 'ออกจากเต็มจอ' : 'เต็มจอ'}
          className="flex h-8 w-8 flex-none items-center justify-center rounded-md transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-accent"
        >
          <PreviewIcon name={fullscreen ? 'fullscreen-exit' : 'fullscreen'} />
        </FullscreenButton>
      </div>
    </div>
  )
}

export default function WorkspacePage() {
  const { id } = useParams<{ id: string }>()

  const { request: requestNavigation } = useNavigationGuard()
  const [loadError, setLoadError] = useState<unknown>(null)
  const [actionError, setActionError] = useState<unknown>(null)
  const [resp, setResp] = useState<VideoResp | null>(null)
  const [notFound, setNotFound] = useState(false)
  const analysis = useAnalysis(id)
  const [candidateFilters, setCandidateFilters] = useState<CandidateFilters>({ tag: null, minScore: null, includeSuppressed: false })
  const scoringAvailable = analysis.candidates.some(c => c.assessment && c.score !== null)
  const candidates = filterCandidates(analysis.candidates, { ...candidateFilters, minScore: scoringAvailable ? candidateFilters.minScore : null })
  const [clips, setClips] = useState<Clip[]>([])
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [exportSel, setExportSel] = useState<Record<string, boolean>>({})
  const [currentTime, setCurrentTime] = useState(0)
  const [previewRange, setPreviewRange] = useState<PreviewRange | null>(null)
  const [canceling, setCanceling] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [modelPrompt, setModelPrompt] = useState<'retry' | 'repair' | null>(null)
  const [exportsTick, setExportsTick] = useState(0)
  const [listTab, setListTab] = useState<'clips' | 'candidates'>('clips')
  const [exportOpen, setExportOpen] = useState(false)

  const playerRef = useRef<MediaPlayerInstance>(null)
  const editorPanelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selectedClipId && window.matchMedia("(max-width: 1023px)").matches) editorPanelRef.current?.scrollIntoView({ block: "start" })
  }, [selectedClipId])
  const videoContainerRef = useRef<HTMLDivElement>(null)
  const lastDisplayedTime = useRef(0)

  const refetchAll = useCallback(() => {
    Promise.all([
      api.videos({ id }).get(),
      api.videos({ id }).clips.get(),
    ]).then(([v, cl]) => {
      if (v.data) setResp(v.data as VideoResp)
      else if (v.error?.status === 404) setNotFound(true)
      else if (v.error) throw v.error
      checkResponse(cl)
      setLoadError(null)
      if (cl.data) setClips(cl.data as Clip[])
    }).catch(setLoadError)
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

  function setVideoTime(t: number) {
    if (Math.abs(t - lastDisplayedTime.current) >= 0.25) {
      lastDisplayedTime.current = t
      setCurrentTime(t)
    }
    const player = playerRef.current
    if (player && Math.abs(player.currentTime - t) >= 0.01) player.currentTime = t
  }

  function seek(t: number) {
    setPreviewRange(null)
    setVideoTime(t)
  }

  function selectClip(clipId: string) {
    if (clipId === selectedClipId) { setExportOpen(false); return }
    requestNavigation(() => {
    const clip = clips.find(row => row.id === clipId)
    setSelectedClipId(clipId)
    setExportOpen(false)
    const range = clip && previewRangeForClip(clip)
    setPreviewRange(range ?? null)
    if (range) setVideoTime(range.start)
    })
  }

  function onVideoTimeUpdate(time: number) {
    const player = playerRef.current
    const next = previewRange && player && !player.paused ? nextPreviewPosition(time, previewRange) : null
    if (next != null) {
      setVideoTime(next)
      void player?.play().catch(() => {})
      return
    }
    if (Math.abs(time - lastDisplayedTime.current) >= 0.25) {
      lastDisplayedTime.current = time
      setCurrentTime(time)
    }
  }

  async function createRange(start: number, end: number) {
    const created = checkResponse(await api.videos({ id }).clips.post({ start, end })).data
    if (created) {
      setClips(previous => [...previous, created as Clip])
      setListTab('clips')
      requestNavigation(() => {
        setSelectedClipId(created.id)
        setExportOpen(false)
        setPreviewRange({ start, end })
        setVideoTime(start)
      })
    }
    refetchAll()
  }

  async function cancelJob() {
    if (!resp?.job || canceling) return
    setCanceling(true)
    setActionError(null)
    try { checkResponse(await api.jobs({ id: resp.job.id }).cancel.post()); refetchAll() }
    catch (error) { setActionError(error) } finally { setCanceling(false) }
  }

  function retry() {
    if (retrying || repairing) return
    setModelPrompt('retry')
  }

  function repair() {
    if (repairing || retrying) return
    requestNavigation(() => setModelPrompt('repair'))
  }

  async function startTranscription(model: WhisperModel): Promise<string | null> {
    if (!modelPrompt) return 'ไม่พบงานถอดเสียงที่ต้องการเริ่ม'
    const action = modelPrompt
    if (action === 'retry') setRetrying(true)
    else setRepairing(true)
    try {
      const response = action === 'retry'
        ? await api.videos({ id }).retry.post({ model })
        : await api.videos({ id }).repair.post({ model })
      checkResponse(response)
      refetchAll()
      return null
    } catch (error) {
      throw error
    } finally {
      if (action === 'retry') setRetrying(false)
      else setRepairing(false)
    }
  }

  function toggleExport(clipId: string) {
    setExportSel(prev => ({ ...prev, [clipId]: !prev[clipId] }))
  }

  if (notFound) {
    return (
      <AppShell active="library">
        <div className="flex flex-col items-center gap-3 px-8 py-20 text-center">
          <div className="text-[15px] font-semibold">ไม่พบวิดีโอนี้</div>
          <Link href="/" className="text-[14px] text-accent hover:underline">
            ← กลับไปคลังวิดีโอ
          </Link>
        </div>
      </AppShell>
    )
  }

  if (!resp) {
    return (
      <AppShell active="library">
        <div className="px-4 py-12"><ErrorNotice error={loadError} onRetry={refetchAll} />{!loadError && <p role="status">กำลังโหลดวิดีโอ…</p>}</div>
      </AppShell>
    )
  }

  const { video, job } = resp
  const isProcessing = video.status === 'uploaded' || video.status === 'processing'
  const isFailed = video.status === 'failed'
  const isReady = video.status === 'ready'
  const duration = video.duration ?? 0
  const selectedClip = clips.find(c => c.id === selectedClipId) ?? null
  const selectionForExport = exportSelectionForWorkspace(clips, exportSel, selectedClipId)
  const exportCount = Object.keys(selectionForExport).length

  return (
    <AppShell active="library" workspace={isReady}>
      <div className="sp-workspace-page">
        <div className="sp-workspace-toolbar">
          <Link
            href="/"
            aria-label="คลังวิดีโอ"
            className="sp-button sp-button-quiet"
          >
            <ArrowLeft size={17} aria-hidden="true" /><span className="hidden sm:inline">คลังวิดีโอ</span>
          </Link>
          <div className="min-w-0 flex-1"><h1 className="truncate text-[14px] font-medium" title={video.filename}>{video.filename}</h1><p className="mt-1 text-[11px] text-muted tabular-nums">{video.duration ? fmtTime(video.duration) : '--:--:--'} · {video.languageName} · {transcriptionLabel(video.whisperModel)}</p></div>
          {isProcessing && (
            <button
              type="button"
              onClick={cancelJob}
              disabled={canceling || !job}
              className="sp-button text-err"
            >
              {canceling ? 'กำลังยกเลิก…' : 'ยกเลิกงาน'}
            </button>
          )}
          {isReady && <>
            <button
              type="button"
              onClick={repair}
              disabled={repairing}
              className="sp-button sp-button-quiet"
              aria-label="ถอดเสียงและหาช่วงแนะนำใหม่"
              title="ถอดเสียงและหาช่วงแนะนำใหม่"
            >
              <ArrowClockwise size={17} aria-hidden="true" /><span className="hidden xl:inline">{repairing ? 'กำลังเริ่ม…' : 'ถอดเสียงใหม่'}</span>
            </button>
            <button type="button" aria-expanded={exportOpen} aria-controls="workspace-export-panel" onClick={() => setExportOpen(open => !open)} className="sp-button sp-button-primary"><DownloadSimple size={17} aria-hidden="true" />ส่งออก{exportCount > 0 ? ` (${exportCount})` : ''}</button>
          </>}
        </div>

        <div className="px-4"><ErrorNotice error={loadError} onRetry={refetchAll} /><ErrorNotice error={actionError} /></div>
        {modelPrompt && (
          <WhisperModelDialog
            savedModel={video.whisperModel}
            onCancel={() => setModelPrompt(null)}
            onStart={startTranscription}
          />
        )}

        {isProcessing && <ProcessingView videoId={id} duration={video.duration} job={job} />}

        {isFailed && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3.5 px-8 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-err/15 text-[18px] text-err">✕</div>
            <div className="text-[15px] font-semibold">ประมวลผลไม่สำเร็จ</div>
            <ErrorNotice error={job?.error || "Processing failed"} fallback="ประมวลผลวิดีโอไม่สำเร็จ คุณสามารถลองถอดเสียงใหม่ได้" />
            <div className="max-w-[520px] text-[12px] text-faint">เริ่มใหม่เพื่อถอดเสียงและหาช่วงแนะนำอีกครั้ง คลิปและไฟล์ส่งออกเดิมจะยังอยู่</div>
            <button
              type="button"
              onClick={retry}
              disabled={retrying}
              className="mt-1.5 rounded-lg bg-accent px-4 py-2 text-[14px] font-semibold text-[#1a120b] transition-[filter] hover:brightness-110 disabled:opacity-50"
            >
              {retrying ? 'กำลังลองใหม่…' : 'ถอดใหม่'}
            </button>
          </div>
        )}

        {isReady && (
          <div className="sp-editor-grid">
            <aside className="sp-clip-sidebar" aria-label="รายการคลิปและช่วงแนะนำ">
              <div className="sp-sidebar-heading"><div role="tablist" aria-label="เลือกแหล่งคลิป" className="sp-tabs" onKeyDown={handleTabKeyDown}>
                <button type="button" id="workspace-clips-tab" role="tab" tabIndex={listTab === 'clips' ? 0 : -1} aria-selected={listTab === 'clips'} aria-controls="workspace-clips-panel" className="sp-tab px-2 text-[12px]" onClick={() => setListTab('clips')}><Scissors size={15} aria-hidden="true" />คลิปของฉัน</button>
                <button type="button" id="workspace-candidates-tab" role="tab" tabIndex={listTab === 'candidates' ? 0 : -1} aria-selected={listTab === 'candidates'} aria-controls="workspace-candidates-panel" className="sp-tab px-2 text-[12px]" onClick={() => setListTab('candidates')}><Sparkle size={15} aria-hidden="true" />AI แนะนำ</button>
              </div></div>
              <div className="sp-scroll-area sp-sidebar-body">
                <div id="workspace-clips-panel" role="tabpanel" aria-labelledby="workspace-clips-tab" hidden={listTab !== 'clips'}><ClipStrip videoId={id} clips={clips} selectedClipId={selectedClipId} exportSel={exportSel} onSelect={selectClip} onToggleExport={toggleExport} /></div>
                <div id="workspace-candidates-panel" role="tabpanel" aria-labelledby="workspace-candidates-tab" hidden={listTab !== 'candidates'}><CandidatePanel videoId={id} candidates={candidates} analysis={analysis} filters={candidateFilters} onFilters={setCandidateFilters} clips={clips as ClipRef[]} onSeek={seek} onAccepted={() => { refetchAll(); setListTab('clips') }} /></div>
              </div>
            </aside>
            <div className="sp-preview-area">
              <MediaPlayer
                ref={playerRef}
                src={{ src: `${API_BASE}/videos/${id}/stream`, type: 'video/mp4' }}
                title={video.filename}
                viewType="video"
                playsInline
                preload="metadata"
                className="sp-video-player group"
                onTimeUpdate={({ currentTime: time }) => onVideoTimeUpdate(time)}
                onSeeking={time => {
                  if (previewRange && !isTimeWithinPreviewRange(time, previewRange)) {
                    setPreviewRange(null)
                  }
                }}
                onLoadedMetadata={() => setVideoTime(playerRef.current?.currentTime ?? 0)}
              >
                <MediaProvider />
                <div ref={videoContainerRef} className="pointer-events-none absolute inset-0 z-10">
                  <div className="pointer-events-none absolute top-2.5 left-3 z-20 font-mono text-[12px] text-[#c9c4bb]">
                    {previewRange ? "ตัวอย่างคลิป" : "วิดีโอต้นฉบับ"}
                  </div>
                  {previewRange && (
                    <button
                      type="button"
                      onClick={() => setPreviewRange(null)}
                      className="pointer-events-auto absolute top-2.5 right-3 z-20 rounded-md bg-black/70 px-2 py-1 font-mono text-[12px] text-[#c9c4bb] transition-colors hover:text-accent"
                    >
                      ดูวิดีโอเต็ม
                    </button>
                  )}
                  <PreviewControls currentTime={currentTime} duration={duration} onSeek={setVideoTime} />
                </div>
              </MediaPlayer>
              <div className="sp-preview-caption"><span>{previewRange ? `คลิป ${fmtTime(previewRange.start)} – ${fmtTime(previewRange.end)}` : 'วิดีโอต้นฉบับ'}</span><span>{selectedClip ? `${(selectedClip.end - selectedClip.start).toFixed(1)} วินาที` : 'เลือกช่วงบน timeline เพื่อสร้างคลิป'}</span></div>
            </div>
            <div className="sp-timeline-area">
              <Timeline
                duration={duration}
                currentTime={currentTime}
                candidates={candidates}
                onSeek={seek}
                onCreateRange={createRange}
                selectedRange={selectedClip ? { start: selectedClip.start, end: selectedClip.end } : null}
              />
            </div>
            <aside ref={editorPanelRef} className="sp-inspector sp-scroll-area" aria-label="เครื่องมือและการส่งออก"><div className="sp-inspector-content">
              <div id="workspace-export-panel" hidden={!exportOpen} className="space-y-5">
                <div className="flex items-center justify-between"><h2 className="sp-section-title">ส่งออกวิดีโอ</h2><button type="button" aria-label="ปิดตัวเลือกส่งออก" onClick={() => setExportOpen(false)} className="sp-button sp-button-quiet"><X size={17} aria-hidden="true" /></button></div>
                <ExportBar clips={clips} exportSel={selectionForExport} onExported={() => setExportsTick(t => t + 1)} />
                <ExportList videoId={id} clips={clips} refreshKey={exportsTick} />
              </div>
              <div hidden={exportOpen}>
            {!selectedClip ? <div className="sp-empty"><SlidersHorizontal size={32} aria-hidden="true" className="mx-auto mb-4 text-accent" /><h2 className="sp-section-title text-ink">เริ่มตัดคลิป</h2><p className="mt-3 text-[13px]">เลือกคลิปทางซ้ายเพื่อปรับเวลา จัดเฟรม และแก้คำบรรยาย</p><p className="mt-3 text-[12px]">ยังไม่มีคลิป? เลือกช่วงบน timeline แล้วกดสร้างคลิป</p></div> : (
              <ClipEditor
                key={selectedClip.id}
                clip={selectedClip}
                duration={duration}
                videoContainerRef={videoContainerRef}
                videoWidth={video.width ?? 16}
                videoHeight={video.height ?? 9}
                active={!exportOpen}
                onClose={() => { setSelectedClipId(null); setPreviewRange(null) }}
                onUpdated={refetchAll}
                onDeleted={() => {
                  // Deleting a clip cascades to delete its exports server-side, but that
                  // doesn't emit an export:update event — bump exportsTick so ExportList
                  // drops any now-orphaned rows for this clip instead of showing stale ones.
                  setSelectedClipId(null)
                  setPreviewRange(null)
                  refetchAll()
                  setExportsTick(t => t + 1)
                }}
              />
            )}
              </div>
            </div></aside>
          </div>
        )}
      </div>
    </AppShell>
  )
}
