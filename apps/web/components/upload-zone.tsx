'use client'

import { useRef, useState } from 'react'
import { api, API_BASE } from '@/lib/api'

type Language = 'th' | 'en'

const ACCEPTED_EXT = ['.mp4', '.mov', '.mkv']

export function UploadZone({ onUploaded }: { onUploaded?: () => void }) {
  const [language, setLanguage] = useState<Language>('th')
  const [pathMode, setPathMode] = useState(false)
  const [pathValue, setPathValue] = useState('')
  const [pathError, setPathError] = useState<string | null>(null)
  const [pathSubmitting, setPathSubmitting] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const [uploading, setUploading] = useState(false)
  const [uploadFilename, setUploadFilename] = useState('')
  const [uploadPct, setUploadPct] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  function uploadFile(file: File) {
    setUploadError(null)
    setUploadFilename(file.name)
    setUploadPct(0)
    setUploading(true)

    const form = new FormData()
    form.append('file', file)
    form.append('language', language)

    const xhr = new XMLHttpRequest()
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) setUploadPct(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      setUploading(false)
      if (xhr.status >= 200 && xhr.status < 300) {
        onUploaded?.()
      } else {
        let message = 'อัปโหลดไม่สำเร็จ'
        try {
          const body = JSON.parse(xhr.responseText)
          if (body?.message) message = body.message
        } catch {
          // ignore parse failure, keep default message
        }
        setUploadError(message)
      }
    }
    xhr.onerror = () => {
      setUploading(false)
      setUploadError('อัปโหลดไม่สำเร็จ (เชื่อมต่อเซิร์ฟเวอร์ไม่ได้)')
    }
    xhr.open('POST', `${API_BASE}/videos`)
    xhr.send(form)
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) uploadFile(file)
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) uploadFile(file)
  }

  async function submitPath() {
    const path = pathValue.trim()
    if (!path) return
    setPathSubmitting(true)
    setPathError(null)
    const { error } = await api.videos.post({ path, language })
    setPathSubmitting(false)
    if (error) {
      const value = error.value as { message?: string } | undefined
      setPathError(value?.message ?? 'ไม่พบไฟล์')
      return
    }
    setPathValue('')
    setPathMode(false)
    onUploaded?.()
  }

  const langLabel = language === 'th' ? 'ไทย' : 'EN'

  if (uploading) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-line3 px-[30px] py-[26px]">
        <div className="flex items-baseline justify-between">
          <div className="text-[14px] font-semibold">{uploadFilename}</div>
          <div className="font-mono text-[12.5px] text-accent">{uploadPct}%</div>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-200"
            style={{ width: `${uploadPct}%` }}
          />
        </div>
        <div className="text-[12px] text-faint">
          กำลังอัปโหลด… เสร็จแล้วจะเข้าคิวประมวลผลอัตโนมัติ (ภาษา: {langLabel})
        </div>
      </div>
    )
  }

  return (
    <div
      onDragOver={e => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`flex flex-col items-center gap-3 rounded-2xl border-[1.5px] border-dashed p-[34px] transition-colors ${
        dragOver ? 'border-accent/60 bg-surface' : 'border-line3'
      }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_EXT.join(',')}
        onChange={onFileChange}
        className="hidden"
      />
      <div className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-accent/15 text-[19px] text-accent">
        ↑
      </div>
      <div className="text-[15px] font-semibold">ลากไฟล์วิดีโอมาวางที่นี่</div>
      <div className="-mt-1.5 text-[12.5px] text-faint">
        รองรับ mp4 · mov · mkv — ไฟล์ใหญ่แนะนำใช้ path ในเครื่อง
      </div>

      <div className="mt-1.5 flex flex-wrap items-center justify-center gap-2.5">
        <div className="flex gap-0.5 rounded-[9px] border border-line2 bg-surface p-[3px]">
          <button
            type="button"
            onClick={() => setLanguage('th')}
            className={`rounded-md px-3 py-1 text-[12.5px] transition-colors ${
              language === 'th' ? 'bg-accent text-[#1a120b]' : 'text-muted hover:text-ink'
            }`}
          >
            ไทย
          </button>
          <button
            type="button"
            onClick={() => setLanguage('en')}
            className={`rounded-md px-3 py-1 text-[12.5px] transition-colors ${
              language === 'en' ? 'bg-accent text-[#1a120b]' : 'text-muted hover:text-ink'
            }`}
          >
            EN
          </button>
        </div>

        {!pathMode ? (
          <>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-[9px] bg-accent px-[18px] py-2 text-[13.5px] font-semibold text-[#1a120b] transition-[filter] hover:brightness-110 active:scale-[0.97]"
            >
              เลือกไฟล์
            </button>
            <button
              type="button"
              onClick={() => {
                setPathMode(true)
                setPathError(null)
              }}
              className="rounded-[9px] border border-line3 px-4 py-2 text-[13.5px] text-[#c9c4bb] transition-colors hover:border-line3/70 hover:text-ink"
            >
              ใช้ path ในเครื่อง
            </button>
          </>
        ) : null}
      </div>

      {pathMode && (
        <div className="mt-1.5 flex w-full max-w-[560px] flex-col gap-2">
          <div className="flex gap-2">
            <input
              autoFocus
              value={pathValue}
              onChange={e => setPathValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') submitPath()
              }}
              placeholder="/Users/you/Videos/live-stream.mp4"
              className="flex-1 rounded-[9px] border border-line2 bg-surface2 px-3 py-2 font-mono text-[12.5px] text-ink placeholder:text-faint"
            />
            <button
              type="button"
              onClick={submitPath}
              disabled={pathSubmitting || !pathValue.trim()}
              className="rounded-[9px] bg-accent px-4 py-2 text-[13.5px] font-semibold text-[#1a120b] transition-[filter] hover:brightness-110 disabled:opacity-50"
            >
              {pathSubmitting ? 'กำลังตรวจสอบ…' : 'ยืนยัน'}
            </button>
            <button
              type="button"
              onClick={() => {
                setPathMode(false)
                setPathError(null)
                setPathValue('')
              }}
              className="rounded-[9px] border border-line3 px-3.5 py-2 text-[13.5px] text-muted hover:text-ink"
            >
              ยกเลิก
            </button>
          </div>
          {pathError && <div className="text-[12.5px] text-err">{pathError}</div>}
        </div>
      )}

      {uploadError && <div className="mt-1 text-[12.5px] text-err">{uploadError}</div>}
    </div>
  )
}
