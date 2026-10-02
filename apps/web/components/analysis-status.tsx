'use client';
import type { AnalysisRunView } from '@shotprompt/core';
import { describeError } from '@/lib/ui-error';
export function AnalysisStatus({ latest, busy, onCancel }: { latest: AnalysisRunView | null; busy: boolean; onCancel: () => void }) {
  if (!latest) return null;
  const running = latest.status === 'running' || latest.status === 'queued';
  const labels = { queued: 'รอประเมิน', running: 'กำลังประเมินช่วงใหม่', done: 'ประเมินเสร็จแล้ว', failed: 'ประเมินไม่สำเร็จ ผลเดิมยังอยู่', canceled: 'ยกเลิกการประเมินแล้ว ผลเดิมยังอยู่' };
  const stages = { discovery: 'อ่านบริบทและค้นหาช่วง', evaluation: 'ประเมินช่วงที่เสนอ', thumbnails: 'สร้างภาพตัวอย่าง' };
  return <div className="space-y-2 rounded-lg bg-bg p-3 text-[13px]"><p role="status">{labels[latest.status]}</p>{running && latest.progress && <p role="status" className="text-[12px] text-muted">{stages[latest.progress.stage]} · {latest.progress.completed}/{latest.progress.total} · {latest.progress.requestCount} คำขอ</p>}{running && <button type="button" disabled={busy} onClick={onCancel} className="rounded border border-line3 px-3 py-1">ยกเลิกการประเมิน</button>}{latest.error && <p className="break-words text-err">{describeError(latest.error, 'ประเมินไม่สำเร็จ ลองใหม่หรือปรับการตั้งค่า AI').message}</p>}</div>;
}
