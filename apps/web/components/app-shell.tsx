'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { isSystemReady } from '@/lib/system-readiness'

type Doctor = {
  ffmpeg: boolean
  ffprobe: boolean
  whisper: boolean
  libx264: boolean
  libass: boolean
  model: { name: string; downloaded: boolean }
  models: { name: string; downloaded: boolean }[]
  acceleration: string
}

export function AppShell({
  active,
  children,
}: {
  active: 'library' | 'settings'
  children: React.ReactNode
}) {
  const [doctor, setDoctor] = useState<Doctor | null>(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.system.doctor
      .get()
      .then(({ data, error }) => {
        if (cancelled) return
        setDoctor(error || !data ? null : (data as Doctor))
        setChecked(true)
      })
      .catch(() => {
        if (!cancelled) {
          setDoctor(null)
          setChecked(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const ready = checked && !!doctor && isSystemReady(doctor)

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-[54px] flex-none items-center gap-5 border-b border-line bg-header px-5">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded-lg bg-accent pl-0.5 text-[11px] text-white">
            ▶
          </span>
          <span className="text-[15px] font-bold tracking-tight">ShotPrompt</span>
        </Link>
        <nav className="flex gap-1">
          <Link
            href="/"
            className={`rounded-lg px-3.5 py-1.5 text-[13.5px] transition-colors ${
              active === 'library' ? 'bg-line2 text-ink' : 'text-muted hover:text-ink'
            }`}
          >
            คลังวิดีโอ
          </Link>
          <Link
            href="/settings"
            className={`rounded-lg px-3.5 py-1.5 text-[13.5px] transition-colors ${
              active === 'settings' ? 'bg-line2 text-ink' : 'text-muted hover:text-ink'
            }`}
          >
            ตั้งค่า
          </Link>
        </nav>
        <div className="flex-1" />
        {!checked ? (
          <div className="flex items-center gap-2 rounded-lg px-3 py-1.5">
            <span className="h-[7px] w-[7px] rounded-full bg-dim" />
            <span className="text-[12.5px] text-muted">กำลังตรวจสอบระบบ…</span>
          </div>
        ) : ready ? (
          <Link
            href="/settings"
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 transition-colors hover:bg-line2"
          >
            <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-ok" />
            <span className="text-[12.5px] text-muted">ระบบพร้อม · GPU: ยังไม่ยืนยัน</span>
          </Link>
        ) : (
          <Link
            href="/setup"
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 transition-colors hover:bg-line2"
          >
            <span className="h-[7px] w-[7px] rounded-full bg-err" />
            <span className="text-[12.5px] text-err">ต้องติดตั้งเพิ่ม</span>
          </Link>
        )}
        <div className="font-mono text-[11.5px] text-faint">v0.1 · 127.0.0.1</div>
      </header>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
