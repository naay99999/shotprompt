'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { ModelManager } from '@/components/model-manager';
import { SystemSummary } from '@/components/system-summary';
import { ConfirmDialog, ErrorNotice } from '@/components/ui-feedback';
import { api } from '@/lib/api';
import { fmtBytes } from '@/lib/format';
import { useSystem } from '@/lib/use-system';
import { checkResponse } from '@/lib/ui-error';
import { useEvents } from '@/lib/use-events';
import { AnalysisSettings } from '@/components/analysis-settings';

type DiskUsage = { total: number; videos: { id: string; filename: string; bytes: number }[] };
export default function SettingsPage() {
  const { system, loading, error, refresh } = useSystem();
  const [disk, setDisk] = useState<DiskUsage | null>(null);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [diskError, setDiskError] = useState<unknown>(null);
  const [deleting, setDeleting] = useState<{ id: string; filename: string } | null>(null);
  const [notice, setNotice] = useState('');
  const refetch = useCallback(async () => {
    setDiskError(null);
    try {
      const [d, v] = await Promise.all([api.system['disk-usage'].get(), api.videos.get()]);
      checkResponse(d); checkResponse(v);
      if (d.data) setDisk(d.data);
      if (v.data) setBusyIds(v.data.filter(row => row.status === 'uploaded' || row.status === 'processing').map(row => row.id));
    } catch (error) { setDiskError(error); }
  }, []);
  useEffect(() => { void refetch(); }, [refetch]);
  useEvents(event => { if (['$reconnect', 'video:update', 'job:update', 'export:update'].includes(event.type)) void refetch(); });
  return <AppShell active="settings"><div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-8">
    <h1 className="text-2xl font-bold">ตั้งค่า</h1>
    <AnalysisSettings />
    <section className="space-y-4 rounded-2xl border border-line3 bg-surface p-5"><h2 className="text-lg font-semibold">ความพร้อมของเครื่อง</h2>
      <ErrorNotice error={error} onRetry={refresh} />{loading && <p role="status">กำลังตรวจสอบ…</p>}{system && <SystemSummary system={system} />}
      <Link href="/setup" className="inline-flex items-center text-accent">เปิดขั้นตอนเตรียมเครื่อง →</Link>
    </section>
    {system && <section className="rounded-2xl border border-line3 bg-surface p-5"><ModelManager system={system} onChanged={refresh} /></section>}
    <section className="space-y-3 rounded-2xl border border-line3 bg-surface p-5"><h2 className="text-lg font-semibold">พื้นที่จัดเก็บ</h2>
      <p className="text-[14px] text-muted">ShotPrompt ใช้พื้นที่ {disk ? fmtBytes(disk.total) : '…'} รวมวิดีโอ คลิป และไฟล์ถอดเสียง</p>
      <ErrorNotice error={diskError} onRetry={refetch} /><p role="status" className="text-[14px] text-ok">{notice}</p>
      {!disk && !diskError && <p role="status">กำลังโหลดรายการ…</p>}
      {disk?.videos.length === 0 && <p className="text-muted">ยังไม่มีวิดีโอ เริ่มเพิ่มวิดีโอได้จากคลังวิดีโอ</p>}
      {disk?.videos.map(video => <div key={video.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line3 p-3">
        <span className="min-w-0 flex-1 break-words text-[14px]">{video.filename}</span><span className="text-[12px] text-muted">{fmtBytes(video.bytes)}</span>
        <button type="button" disabled={busyIds.includes(video.id)} onClick={() => setDeleting(video)} className="rounded-lg border border-line3 px-3 py-2 text-err">ลบวิดีโอ</button>
        {busyIds.includes(video.id) && <p className="w-full text-[12px] text-muted">รอให้งานเสร็จก่อนลบวิดีโอ</p>}
      </div>)}
    </section>
    {deleting && <ConfirmDialog title="ลบวิดีโอนี้?" onClose={() => setDeleting(null)} onConfirm={async () => {
      checkResponse(await api.videos({ id: deleting.id }).delete()); setNotice('ลบวิดีโอและงานที่เกี่ยวข้องแล้ว'); await refetch();
    }}><p className="break-words font-semibold text-ink">{deleting.filename}</p><p className="mt-2">สำเนาวิดีโอ คลิป คำบรรยาย และไฟล์ส่งออกที่ ShotPrompt เก็บไว้จะถูกลบถาวร ไฟล์ต้นฉบับนอก ShotPrompt จะยังอยู่</p></ConfirmDialog>}
  </div></AppShell>;
}
