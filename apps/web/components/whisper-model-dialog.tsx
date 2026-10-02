'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getPreferredWhisperModel, type WhisperModel } from '@/lib/whisper-options';
import { useSystem } from '@/lib/use-system';
import { Modal, ErrorNotice } from './ui-feedback';
import { TranscriptionSelect } from './transcription-select';
export function WhisperModelDialog({ savedModel, onCancel, onStart }: {
  savedModel?: string | null; onCancel: () => void; onStart: (model: WhisperModel) => Promise<string | null>;
}) {
  const { system, loading, error: loadError, refresh } = useSystem();
  const [model, setModel] = useState<WhisperModel | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { if (system) setModel(getPreferredWhisperModel(system, savedModel)); }, [system, savedModel]);
  return <Modal title="ถอดเสียงและหาช่วงแนะนำใหม่" busy={submitting} onClose={onCancel}>
    <p className="mb-4 text-[14px] text-muted">ระบบจะสร้างข้อความถอดเสียงและช่วงแนะนำใหม่ คลิป คำบรรยายที่แก้ไว้ในคลิป และไฟล์ส่งออกเดิมจะยังอยู่</p>
    <ErrorNotice error={loadError} onRetry={refresh} />{loading && <p role="status">กำลังตรวจสอบรูปแบบที่พร้อมใช้…</p>}
    <TranscriptionSelect options={system} value={model} onChange={setModel} disabled={submitting} />
    {!loading && !loadError && !model && <Link href="/settings" className="inline-flex items-center text-accent">ดาวน์โหลดไฟล์ถอดเสียงในหน้าตั้งค่า →</Link>}
    <ErrorNotice error={error} />
    <p className="mt-3 text-[12px] text-muted">รูปแบบที่เลือกจะใช้กับวิดีโอนี้และการถอดใหม่ครั้งถัดไป</p>
    <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" onClick={onCancel} disabled={submitting} className="rounded-lg border border-line3 px-4 py-2">ยกเลิก</button>
      <button type="button" disabled={!model || loading || !!loadError || submitting} className="rounded-lg bg-accent px-4 py-2 font-semibold text-bg" onClick={async () => {
        if (!model) return; setSubmitting(true); setError(null);
        try { const message = await onStart(model); if (message) setError(message); else onCancel(); } catch (error) { setError(error); } finally { setSubmitting(false); }
      }}>{submitting ? 'กำลังเริ่ม…' : 'เริ่มถอดเสียงใหม่'}</button>
    </div>
  </Modal>;
}
