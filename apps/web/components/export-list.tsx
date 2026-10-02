'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, API_BASE } from '@/lib/api';
import { ASPECT_LABEL, fmtTime, type Aspect } from '@/lib/format';
import { checkResponse } from '@/lib/ui-error';
import { useEvents } from '@/lib/use-events';
import { ConfirmDialog, ErrorNotice } from './ui-feedback';
import type { Clip } from './clip-strip';
type ExportRow = { id: string; clipId: string; aspect: Aspect; burnSubtitles: boolean; status: 'queued' | 'rendering' | 'done' | 'failed'; path: string | null; error: string | null; createdAt: number };
export function ExportList({ videoId, clips, refreshKey }: { videoId: string; clips: Clip[]; refreshKey: number }) {
  const [rows, setRows] = useState<ExportRow[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [deleting, setDeleting] = useState<ExportRow | null>(null);
  const refetch = useCallback(async () => {
    try { const response = checkResponse(await api.videos({ id: videoId }).exports.get()); if (response.data) setRows(response.data as ExportRow[]); setError(null); }
    catch (error) { setError(error); }
  }, [videoId]);
  useEffect(() => { void refetch(); }, [refetch, refreshKey]);
  useEvents(event => { if (event.type === '$reconnect' || (event.type === 'export:update' && event.videoId === videoId)) void refetch(); });
  if (!rows.length && !error) return null;
  return <section className="space-y-3"><h2 className="font-semibold">ไฟล์ส่งออก</h2><ErrorNotice error={error} onRetry={refetch} />
    {rows.map(row => { const clip = clips.find(clip => clip.id === row.clipId); const busy = ['queued', 'rendering'].includes(row.status); return <article key={row.id} className="space-y-2 rounded-xl border border-line3 bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-[14px]">คลิป {clip ? fmtTime(clip.start) : 'ที่ส่งออก'}</h3><span role="status" className="text-[12px] text-muted">{row.status === 'done' ? '✓ พร้อมดาวน์โหลด' : row.status === 'failed' ? 'สร้างไฟล์ไม่สำเร็จ' : row.status === 'queued' ? 'รอคิว…' : 'กำลังสร้างไฟล์…'}</span></div>
      <p className="text-[12px] text-muted">{ASPECT_LABEL[row.aspect]} · {row.burnSubtitles ? 'มีคำบรรยายในภาพ' : 'ไม่มีคำบรรยายในภาพ'}</p>
      {row.status === 'rendering' && <progress aria-label="กำลังสร้างไฟล์วิดีโอ" className="w-full" />}
      {row.status === 'failed' && <ErrorNotice error={row.error || 'Export failed'} fallback="สร้างไฟล์ไม่สำเร็จ เลือกคลิปด้านบนแล้วส่งออกอีกครั้งได้" />}
      <div className="flex flex-wrap gap-3">{row.status === 'done' && <a href={`${API_BASE}/exports/${row.id}/download`} className="inline-flex items-center rounded-lg bg-accent px-4 py-2 font-semibold text-bg">ดาวน์โหลดวิดีโอ</a>}{!busy && <button type="button" onClick={() => setDeleting(row)} className="rounded-lg border border-line3 px-3 py-2 text-err">ลบไฟล์ส่งออก</button>}</div>
    </article>; })}
    {deleting && <ConfirmDialog title="ลบไฟล์ส่งออกนี้?" onClose={() => setDeleting(null)} onConfirm={async () => { checkResponse(await api.exports({ id: deleting.id }).delete()); await refetch(); }}><p>ไฟล์ {ASPECT_LABEL[deleting.aspect]} ของคลิป {fmtTime(clips.find(clip => clip.id === deleting.clipId)?.start ?? 0)} จะถูกลบจาก ShotPrompt คลิปและคำบรรยายจะยังอยู่ และส่งออกใหม่ได้</p></ConfirmDialog>}
  </section>;
}
