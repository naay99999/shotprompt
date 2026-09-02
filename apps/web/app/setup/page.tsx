'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useEvents } from '@/lib/use-events'

type Doctor = {
  ffmpeg: boolean
  ffprobe: boolean
  whisper: boolean
  libass: boolean
  model: { name: string; downloaded: boolean }
  models: { name: string; downloaded: boolean }[]
  acceleration: string
  installGuide: {
    platform: 'macos' | 'linux' | 'windows' | 'unknown'
    architecture: string
    manager: 'homebrew' | 'scoop' | 'winget' | 'manual'
    commands: string[]
    note: string
    manualUrl: string
  }
}

const MODEL_INFO: Record<string, { size: string; desc: string }> = {
  'large-v3': { size: '3.1 GB', desc: 'แม่นยำที่สุดสำหรับภาษาไทย' },
  medium: { size: '1.5 GB', desc: 'เร็วกว่า ~2–3 เท่า แม่นยำลดลงเล็กน้อย' },
}
const MODEL_ORDER = ['large-v3', 'medium']
// The server accepts any whisper.cpp model name (e.g. `tiny`, handy for local dev) —
// fall back to something sensible when the configured model isn't one of the two
// canonical picks the UI otherwise shows.
const UNKNOWN_MODEL_INFO = { size: '', desc: 'โมเดลที่กำหนดเอง' }

const PLATFORM_LABEL = {
  macos: 'macOS',
  linux: 'Linux',
  windows: 'Windows',
  unknown: 'ระบบไม่ทราบชนิด',
} as const

type DlState = { received: number; total: number; done: boolean; error?: string } | null

export default function SetupPage() {
  const router = useRouter()
  const [doctor, setDoctor] = useState<Doctor | null>(null)
  const [checking, setChecking] = useState(true)
  const [copied, setCopied] = useState(false)
  const [dl, setDl] = useState<DlState>(null)
  const [selectedModel, setSelectedModel] = useState<string | null>(null)

  const recheck = useCallback(() => {
    setChecking(true)
    return api.system.doctor.get().then(({ data }) => {
      if (data) {
        const next = data as Doctor
        setDoctor(next)
        setSelectedModel(next.model.name)
      }
      setChecking(false)
    })
  }, [])

  useEffect(() => {
    recheck()
  }, [recheck])

  useEvents(e => {
    if (e.type === '$reconnect') {
      recheck()
      return
    }
    if (e.type === 'model:download' && typeof e.model === 'string') {
      if (e.model !== modelName) return
      setDl({
        received: (e.received as number) ?? 0,
        total: (e.total as number) ?? 0,
        done: (e.done as boolean) ?? false,
        error: e.error as string | undefined,
      })
      if (e.done) recheck()
    }
  })

  const installGuide = doctor?.installGuide
  const installCommand = installGuide?.commands.join('\n') ?? ''

  function copy() {
    if (!installCommand) return
    try {
      navigator.clipboard.writeText(installCommand)
    } catch {
      /* clipboard unavailable — button still flips to give feedback */
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  async function downloadModel() {
    if (!doctor) return
    setDl({ received: 0, total: 0, done: false })
    await api.system.model.download.post({ model: modelName })
  }

  async function selectModel(name: string) {
    setSelectedModel(name)
    setDl(null)
    await api.settings.put({ whisperModel: name })
    setDoctor(current => current
      ? { ...current, model: { name, downloaded: current.models.find(model => model.name === name)?.downloaded ?? false } }
      : current)
  }

  const modelName = selectedModel ?? doctor?.model.name ?? 'large-v3'
  const modelInfo = MODEL_INFO[modelName] ?? UNKNOWN_MODEL_INFO
  const modelDownloaded = doctor?.model.downloaded ?? false
  const modelBusy = !!dl && !dl.done
  const modelPct = dl && dl.total > 0 ? Math.round((dl.received / dl.total) * 100) : 0

  const binariesOk = !!doctor?.ffmpeg && !!doctor?.ffprobe
  const whisperOk = !!doctor?.whisper
  const libassOk = !!doctor?.libass
  // Subtitle burning needs libass, but the app is otherwise fully usable without it
  // (see app-shell.tsx's `ready` calc for the same call) — so it's shown as a warning
  // row here, not a blocker for "เริ่มใช้งาน ShotPrompt →".
  const allPassed = !checking && binariesOk && whisperOk && modelDownloaded

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-6 py-10">
      <div className="flex w-[520px] max-w-full animate-[fadeUp_.35s_ease] flex-col gap-5 rounded-[18px] border border-line bg-surface p-[34px] pb-7">
        <div className="flex flex-col items-center gap-2.5 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-[13px] bg-accent pl-0.5 text-base text-white">
            ▶
          </div>
          <div className="text-xl font-bold">ติดตั้ง ShotPrompt</div>
          <div className="-mt-1 text-[13px] text-muted">
            ต้องมีเครื่องมือเหล่านี้ในเครื่องก่อนเริ่มใช้งาน — ติดตั้งครั้งเดียวจบ
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3 rounded-[10px] border border-line bg-surface2 px-3.5 py-2.5">
            <StatusDot ok={binariesOk} />
            <div className="flex-1 font-mono text-[13px]">ffmpeg · ffprobe</div>
            <div className={`text-[11.5px] ${binariesOk ? 'text-dim' : 'text-err'}`}>
              {binariesOk ? 'พบใน PATH' : 'ไม่พบใน PATH'}
            </div>
          </div>

          <div
            className={`flex items-center gap-3 rounded-[10px] border bg-surface2 px-3.5 py-2.5 transition-colors ${
              whisperOk ? 'border-line' : 'border-err/30'
            }`}
          >
            <StatusDot ok={whisperOk} />
            <div className="flex-1 font-mono text-[13px]">whisper-cli</div>
            <div className={`text-[11.5px] ${whisperOk ? 'text-dim' : 'text-err'}`}>
              {whisperOk ? 'พบใน PATH' : 'ไม่พบใน PATH'}
            </div>
          </div>

          <div
            className={`flex items-center gap-3 rounded-[10px] border bg-surface2 px-3.5 py-2.5 transition-colors ${
              libassOk ? 'border-line' : 'border-warn/30'
            }`}
          >
            <StatusDot ok={libassOk} warnWhenMissing />
            <div className="flex-1 font-mono text-[13px]">libass</div>
            <div className={`text-[11.5px] ${libassOk ? 'text-dim' : 'text-warn'}`}>
              {libassOk ? 'รองรับการฝัง subtitle' : 'จำเป็นสำหรับการฝัง subtitle'}
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-bg px-3.5 py-2.5">
            <div className="flex items-center justify-between gap-3 text-[11.5px] text-dim">
              <span>คำแนะนำสำหรับ {installGuide ? PLATFORM_LABEL[installGuide.platform] : 'เครื่องนี้'}</span>
              {installGuide && <span className="font-mono">{installGuide.architecture} · {installGuide.manager}</span>}
            </div>
            {installCommand && (
              <div className="flex items-center gap-2.5">
                <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-[12.5px] text-[#c9c4bb]">{installCommand}</pre>
                <button
                  type="button"
                  onClick={copy}
                  className={`flex-none rounded-[7px] border px-3 py-1.5 text-[11.5px] transition-colors ${
                    copied ? 'border-ok/40 text-ok' : 'border-line3 text-[#c9c4bb] hover:border-[#4a4438]'
                  }`}
                >
                  {copied ? 'คัดลอกแล้ว ✓' : 'คัดลอก'}
                </button>
              </div>
            )}
            <div className="text-[11.5px] text-dim">{installGuide?.note ?? 'กำลังตรวจหาระบบปฏิบัติการและเครื่องมือที่ใช้ติดตั้ง…'}</div>
            {installGuide && (
              <a href={installGuide.manualUrl} target="_blank" rel="noreferrer" className="w-fit text-[11.5px] text-accent hover:underline">
                เปิดคู่มือติดตั้ง →
              </a>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface2 px-3.5 py-2.5">
            <div className="text-[11.5px] font-semibold tracking-[.4px] text-faint">เลือกโมเดลถอดเสียง</div>
            <div className="flex gap-2">
              {MODEL_ORDER.map(name => (
                <button
                  key={name}
                  type="button"
                  onClick={() => selectModel(name)}
                  className={`rounded-md border px-2.5 py-1 text-[11.5px] transition-colors ${
                    modelName === name ? 'border-accent bg-accent/10 text-accent' : 'border-line3 text-dim hover:text-ink'
                  }`}
                >
                  {name === 'large-v3' ? 'แม่นยำ · large-v3' : 'เร็วขึ้น · medium'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
            {modelDownloaded ? (
              <StatusDot ok />
            ) : (
              <div className="h-5 w-5 flex-none rounded-full border-[1.5px] border-line3" />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[13px]">โมเดล {modelName}</div>
              <div className="text-[11.5px] text-dim">
                {modelInfo.size ? `${modelInfo.size} · ${modelInfo.desc}` : modelInfo.desc}
              </div>
            </div>
            {!modelDownloaded && !modelBusy && (
              <button
                type="button"
                onClick={downloadModel}
                className="flex-none rounded-lg bg-accent/[.15] px-3.5 py-1.5 text-[12px] font-semibold text-accent transition-colors hover:bg-accent/25"
              >
                ↓ ดาวน์โหลด
              </button>
            )}
            {modelBusy && (
              <div className="flex flex-none items-center gap-2">
                <div className="h-[5px] w-20 overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${modelPct}%` }} />
                </div>
                <span className="font-mono text-[11.5px] text-accent">{modelPct}%</span>
              </div>
            )}
            {dl?.error && (
              <div className="flex-none text-[11.5px] text-err" title={dl.error}>
                ล้มเหลว
              </div>
            )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => (allPassed ? router.push('/') : recheck())}
          className={`rounded-[10px] py-2.5 text-[13.5px] font-semibold transition-all active:scale-[.98] ${
            allPassed ? 'bg-accent text-[#1a120b]' : 'bg-line2 text-[#c9c4bb]'
          }`}
        >
          {checking
            ? 'กำลังตรวจสอบ…'
            : allPassed
              ? 'เริ่มใช้งาน ShotPrompt →'
              : 'ตรวจสอบอีกครั้ง'}
        </button>
        <div className="-mt-2 text-center text-[11.5px] text-faint">
          ตรวจจาก PATH ของเครื่อง · Apple Silicon ใช้ Metal GPU อัตโนมัติ
        </div>
      </div>
    </div>
  )
}

function StatusDot({ ok, warnWhenMissing }: { ok: boolean; warnWhenMissing?: boolean }) {
  if (ok) {
    return (
      <div className="flex h-5 w-5 flex-none animate-[pop_.35s_ease] items-center justify-center rounded-full bg-ok/[.13] text-[10.5px] font-bold text-ok">
        ✓
      </div>
    )
  }
  return (
    <div
      className={`flex h-5 w-5 flex-none items-center justify-center rounded-full text-[10.5px] font-bold ${
        warnWhenMissing ? 'bg-warn/[.13] text-warn' : 'bg-err/[.13] text-err'
      }`}
    >
      ✕
    </div>
  )
}
