'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { AppShell } from '@/components/app-shell'
import { api } from '@/lib/api'
import { fmtBytes } from '@/lib/format'
import { useEvents } from '@/lib/use-events'

type Doctor = {
  ffmpeg: boolean
  ffprobe: boolean
  whisper: boolean
  libass: boolean
  libx264: boolean
  model: { name: string; downloaded: boolean }
  models: { name: string; downloaded: boolean }[]
  acceleration: string
}

type DiskUsage = {
  total: number
  videos: { id: string; filename: string; bytes: number }[]
}

type VideoSummary = { id: string; status: 'uploaded' | 'processing' | 'ready' | 'failed' }

type DlState = { received: number; total: number; done: boolean; error?: string } | null

const MODEL_INFO: Record<string, { size: string; desc: string }> = {
  'large-v3': { size: '3.1 GB', desc: 'แม่นยำที่สุดสำหรับภาษาไทย — ค่าเริ่มต้นที่แนะนำ' },
  medium: { size: '1.5 GB', desc: 'เร็วกว่า ~2–3 เท่า แม่นยำลดลงเล็กน้อย — เหมาะกับไลฟ์ยาวหลายชั่วโมง' },
}
const MODEL_ORDER = ['large-v3', 'medium']

export default function SettingsPage() {
  const [doctor, setDoctor] = useState<Doctor | null>(null)
  const [disk, setDisk] = useState<DiskUsage | null>(null)
  const [videos, setVideos] = useState<VideoSummary[]>([])
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [downloads, setDownloads] = useState<Record<string, DlState>>({})
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Record<string, boolean>>({})
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const refetchDoctor = useCallback(() => {
    api.system.doctor.get().then(({ data }) => {
      if (data) {
        const d = data as Doctor
        setDoctor(d)
        setSelectedModel(d.model.name)
      }
    })
  }, [])
  const refetchDisk = useCallback(() => {
    api.system['disk-usage'].get().then(({ data }) => {
      if (data) setDisk(data as DiskUsage)
    })
  }, [])
  const refetchVideos = useCallback(() => {
    api.videos.get().then(({ data }) => {
      if (data) setVideos(data as VideoSummary[])
    })
  }, [])

  useEffect(() => {
    refetchDoctor()
    refetchDisk()
    refetchVideos()
  }, [refetchDoctor, refetchDisk, refetchVideos])

  useEvents(e => {
    if (e.type === '$reconnect') {
      refetchDoctor()
      refetchDisk()
      refetchVideos()
      return
    }
    if (e.type === 'video:update' || e.type === 'job:update') {
      refetchDisk()
      refetchVideos()
    }
    if (e.type === 'model:download' && typeof e.model === 'string') {
      const model = e.model
      setDownloads(prev => ({
        ...prev,
        [model]: {
          received: (e.received as number) ?? prev[model]?.received ?? 0,
          total: (e.total as number) ?? prev[model]?.total ?? 0,
          done: (e.done as boolean) ?? false,
          error: e.error as string | undefined,
        },
      }))
      if (e.done) refetchDoctor()
    }
  })

  async function selectModel(name: string) {
    setSelectedModel(name)
    await api.settings.put({ whisperModel: name })
  }

  async function download(name: string) {
    setDownloads(prev => ({ ...prev, [name]: { received: 0, total: 0, done: false } }))
    await api.system.model.download.post({ model: name })
  }

  async function deleteVideo(id: string) {
    if (confirmingDelete !== id) {
      setConfirmingDelete(id)
      return
    }
    setDeleting(prev => ({ ...prev, [id]: true }))
    setDeleteError(null)
    const { error } = await api.videos({ id }).delete()
    setDeleting(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setConfirmingDelete(null)
    if (error) {
      setDeleteError(
        error.status === 409
          ? 'ลบไม่ได้ตอนนี้เพราะวิดีโอกำลังประมวลผลอยู่'
          : 'ลบวิดีโอไม่สำเร็จ',
      )
      return
    }
    refetchDisk()
    refetchVideos()
  }

  const statusById = new Map(videos.map(v => [v.id, v.status]))
  const diskVideos = disk?.videos ?? []
  const maxVideoBytes = Math.max(1, ...diskVideos.map(v => v.bytes))

  const doctorRows = doctor
    ? [
        { name: 'ffmpeg', ok: doctor.ffmpeg, detail: doctor.ffmpeg ? 'พบใน PATH' : 'ไม่พบใน PATH' },
        { name: 'ffprobe', ok: doctor.ffprobe, detail: doctor.ffprobe ? 'พบใน PATH' : 'ไม่พบใน PATH' },
        { name: 'whisper-cli', ok: doctor.whisper, detail: doctor.whisper ? 'พบใน PATH' : 'ไม่พบใน PATH' },
        { name: 'libx264', ok: doctor.libx264, detail: doctor.libx264 ? 'พร้อม export วิดีโอ' : 'ไม่รองรับการ export วิดีโอ' },
        {
          name: 'libass',
          ok: doctor.libass,
          warning: true,
          detail: doctor.libass ? 'รองรับการฝัง subtitle' : 'ไม่รองรับการฝัง subtitle (ไม่บล็อกการใช้งาน)',
        },
        { name: 'acceleration', ok: null, detail: doctor.acceleration === 'unverified' ? 'ยังไม่ยืนยัน' : 'ยังไม่ทราบ' },
      ]
    : []

  return (
    <AppShell active="settings">
      <div className="mx-auto flex max-w-[720px] flex-col gap-[26px] px-8 py-11">
        <div>
          <div className="text-[25px] font-bold">ตั้งค่า</div>
          <div className="mt-1 text-[13.5px] text-muted">สถานะระบบ โมเดลถอดเสียง และพื้นที่ดิสก์</div>
        </div>

        {/* สถานะระบบ */}
        <div className="flex flex-col gap-3.5 rounded-[15px] border border-line bg-surface p-5">
          <div className="flex items-baseline justify-between">
            <div className="text-[14.5px] font-bold">สถานะระบบ</div>
            <Link href="/setup" className="text-[12px] text-accent hover:underline">
              ดูหน้าติดตั้ง →
            </Link>
          </div>
          {!doctor ? (
            <div className="text-[12.5px] text-dim">กำลังตรวจสอบ…</div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {doctorRows.map(d => (
                <div
                  key={d.name}
                  className="flex items-center gap-2.5 rounded-[10px] border border-line bg-surface2 px-3.5 py-2.5"
                >
                  <div
                    className={`flex h-5 w-5 flex-none items-center justify-center rounded-full text-[10.5px] font-bold ${
                      d.ok === true ? 'bg-ok/[.13] text-ok' : d.ok === null ? 'bg-line text-faint' : d.warning ? 'bg-warn/[.13] text-warn' : 'bg-err/[.13] text-err'
                    }`}
                  >
                    {d.ok === true ? '✓' : d.ok === null ? '?' : d.warning ? '!' : '✕'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[13px]">{d.name}</div>
                    <div className={`text-[11.5px] ${d.ok ? 'text-dim' : 'text-err'}`}>{d.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* โมเดลถอดเสียง */}
        <div className="flex flex-col gap-3.5 rounded-[15px] border border-line bg-surface p-5">
          <div className="text-[14.5px] font-bold">โมเดลถอดเสียง (whisper)</div>
          <div className="flex flex-col gap-2.5">
            {MODEL_ORDER.map(name => {
              const info = MODEL_INFO[name]
              const downloaded = doctor?.models.find(m => m.name === name)?.downloaded ?? false
              const dl = downloads[name]
              const busy = !!dl && !dl.done
              const pct = dl && dl.total > 0 ? Math.round((dl.received / dl.total) * 100) : 0
              const selected = selectedModel === name
              return (
                <div
                  key={name}
                  onClick={() => selectModel(name)}
                  className={`flex cursor-pointer items-center gap-3.5 rounded-xl border bg-surface2 px-4 py-3.5 transition-colors ${
                    selected ? 'border-accent' : 'border-line'
                  }`}
                >
                  <div
                    className={`flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full border-2 ${
                      selected ? 'border-accent' : 'border-line3'
                    }`}
                  >
                    <div className={`h-2 w-2 rounded-full ${selected ? 'bg-accent' : 'bg-transparent'}`} />
                  </div>
                  <div className="flex-1">
                    <div className="text-[14px] font-semibold">
                      {name} <span className="text-[11.5px] font-normal text-dim">· {info.size}</span>
                    </div>
                    <div className="mt-0.5 text-[12.5px] text-dim">{info.desc}</div>
                  </div>
                  {downloaded && !busy && (
                    <div className="flex-none rounded-full bg-ok/[.12] px-2.5 py-[3px] text-[11.5px] text-ok">
                      ดาวน์โหลดแล้ว
                    </div>
                  )}
                  {!downloaded && !busy && (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation()
                        download(name)
                      }}
                      className="flex-none rounded-lg border border-line3 px-3.5 py-1.5 text-[12px] text-[#c9c4bb] transition-colors hover:border-accent hover:text-accent"
                    >
                      ↓ ดาวน์โหลด
                    </button>
                  )}
                  {busy && (
                    <div className="flex flex-none items-center gap-2">
                      <div className="h-[5px] w-[70px] overflow-hidden rounded-full bg-line">
                        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="font-mono text-[11.5px] text-accent">{pct}%</span>
                    </div>
                  )}
                  {dl?.error && (
                    <div className="flex-none text-[11.5px] text-err" title={dl.error}>
                      ดาวน์โหลดล้มเหลว
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="text-[12px] text-faint">ดาวน์โหลดต่อจากเดิมได้ถ้าหลุดกลางทาง (resume อัตโนมัติ)</div>
        </div>

        {/* พื้นที่ดิสก์ */}
        <div className="flex flex-col gap-3.5 rounded-[15px] border border-line bg-surface p-5">
          <div className="flex items-baseline justify-between">
            <div className="text-[14.5px] font-bold">พื้นที่ดิสก์</div>
            <div className="text-[12.5px] text-dim">
              รวม <span className="font-mono text-ink">{disk ? fmtBytes(disk.total) : '—'}</span> ใน data/
            </div>
          </div>
          {deleteError && <div className="text-[12px] text-err">{deleteError}</div>}
          <div className="flex flex-col gap-2">
            {diskVideos.length === 0 && <div className="text-[12.5px] text-dim">ยังไม่มีวิดีโอ</div>}
            {diskVideos.map(v => {
              const pct = Math.round((v.bytes / maxVideoBytes) * 100)
              const status = statusById.get(v.id)
              const busy = status === 'processing'
              return (
                <div
                  key={v.id}
                  className="flex items-center gap-3.5 rounded-[10px] border border-line bg-surface2 px-3.5 py-2.5"
                >
                  <div className="min-w-0 flex-1 truncate text-[13px]">{v.filename}</div>
                  <div className="h-[5px] w-[120px] flex-none overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full bg-line3" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="w-16 flex-none text-right font-mono text-[12px] text-dim">{fmtBytes(v.bytes)}</div>
                  <button
                    type="button"
                    onClick={() => deleteVideo(v.id)}
                    disabled={busy || deleting[v.id]}
                    onBlur={() => setConfirmingDelete(prev => (prev === v.id ? null : prev))}
                    title={busy ? 'ลบไม่ได้ระหว่างกำลังประมวลผล' : undefined}
                    className="flex-none rounded-lg border border-line3 px-2.5 py-1.5 text-[11.5px] text-dim transition-colors hover:border-err/40 hover:text-err disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line3 disabled:hover:text-dim"
                  >
                    {deleting[v.id] ? 'กำลังลบ…' : confirmingDelete === v.id ? 'ยืนยันลบ?' : 'ลบ'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </AppShell>
  )
}
