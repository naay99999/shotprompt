'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRightIcon, CpuIcon, HardDrivesIcon, PlugsConnectedIcon, TrashIcon } from '@phosphor-icons/react';
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

const categories = [
  { id: 'connections', label: 'การเชื่อมต่อ AI', detail: 'ผู้ให้บริการและโมเดล', Icon: PlugsConnectedIcon },
  { id: 'transcription', label: 'การถอดเสียงและระบบ', detail: 'โมเดลและความพร้อมของเครื่อง', Icon: CpuIcon },
  { id: 'storage', label: 'พื้นที่จัดเก็บ', detail: 'วิดีโอและไฟล์ที่สร้าง', Icon: HardDrivesIcon },
] as const;

type DiskUsage = { total: number; videos: { id: string; filename: string; bytes: number }[] };
export default function SettingsPage() {
  const { system, loading, error, refresh } = useSystem();
  const [category, setCategory] = useState<(typeof categories)[number]['id']>('connections');
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
  return <AppShell active="settings"><div className="sp-page">
    <header className="sp-page-header">
      <div><h1 className="sp-heading">ตั้งค่า</h1><p className="sp-description mt-3">เลือกการเชื่อมต่อ เตรียมเครื่อง และจัดการไฟล์สำหรับงานตัดต่อ</p></div>
    </header>
    <div className="grid min-w-0 gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
      <nav aria-label="หมวดการตั้งค่า" className="flex min-w-0 flex-wrap gap-2 self-start lg:sticky lg:top-24 lg:flex-col">
        {categories.map(({ id, label, detail, Icon }) => <button key={id} id={`settings-${id}`} type="button" aria-pressed={category === id} aria-controls={`settings-panel-${id}`} onClick={() => setCategory(id)} className={`flex min-h-11 items-start gap-3 rounded-xl px-4 py-3 text-left transition-colors motion-reduce:transition-none ${category === id ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-line1 hover:text-ink'}`}>
          <Icon size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span><span className="block text-sm font-semibold">{label}</span><span className="mt-1 hidden text-xs text-muted lg:block">{detail}</span></span>
        </button>)}
      </nav>
      <div className="min-w-0">
        <div id="settings-panel-connections" role="region" aria-labelledby="settings-connections" hidden={category !== 'connections'}>
          <AnalysisSettings />
        </div>
        <div id="settings-panel-transcription" role="region" aria-labelledby="settings-transcription" hidden={category !== 'transcription'}>
          <div className="space-y-6">
            <section className="sp-panel space-y-5 p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="sp-section-title">ความพร้อมของเครื่อง</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">ShotPrompt ต้องใช้การถอดเสียงในการเตรียมวิดีโอใหม่ ตรวจสอบเครื่องมือก่อนเริ่มนำเข้า</p></div><CpuIcon size={24} className="shrink-0 text-muted" aria-hidden="true" /></div>
              <ErrorNotice error={error} onRetry={refresh} />
              {loading && <p role="status" className="text-sm text-muted">กำลังตรวจสอบ…</p>}
              {system && <SystemSummary system={system} />}
              <Link href="/setup" className="sp-button sp-button-quiet">เปิดขั้นตอนเตรียมเครื่อง <ArrowUpRightIcon size={16} aria-hidden="true" /></Link>
            </section>
            {system && <section className="sp-panel p-5 sm:p-6"><ModelManager system={system} onChanged={refresh} /></section>}
          </div>
        </div>
        <div id="settings-panel-storage" role="region" aria-labelledby="settings-storage" hidden={category !== 'storage'}>
          <section className="sp-panel overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
              <div><h2 className="sp-section-title">พื้นที่จัดเก็บ</h2><p className="mt-2 max-w-2xl text-sm text-muted">วิดีโอ คลิป คำบรรยาย และไฟล์ส่งออกที่ ShotPrompt เก็บไว้</p></div>
              <div className="text-right"><p className="text-2xl font-semibold tabular-nums">{disk ? fmtBytes(disk.total) : '…'}</p><p className="mt-1 text-xs text-muted">พื้นที่ที่ใช้อยู่</p></div>
            </div>
            <div className="px-5 sm:px-6"><ErrorNotice error={diskError} onRetry={refetch} />{notice && <p role="status" className="pb-4 text-sm text-ok">{notice}</p>}</div>
            {!disk && !diskError && <p role="status" className="px-5 pb-6 text-sm text-muted sm:px-6">กำลังโหลดรายการ…</p>}
            {disk?.videos.length === 0 && <div className="sp-empty m-5 sm:m-6"><HardDrivesIcon size={28} aria-hidden="true" className="mb-3 text-muted" /><p className="font-semibold">ยังไม่มีวิดีโอในเครื่อง</p><p className="mt-2 text-sm text-muted">เริ่มเพิ่มวิดีโอได้จากคลังวิดีโอ</p><Link href="/" className="sp-button sp-button-quiet mt-4">เปิดคลังวิดีโอ <ArrowUpRightIcon size={16} aria-hidden="true" /></Link></div>}
            <ul className="divide-y divide-line3 border-t border-line3">
              {disk?.videos.map(video => <li key={video.id} className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6">
                <span className="min-w-0 flex-1 basis-44 break-words text-sm font-medium">{video.filename}</span><span className="text-xs tabular-nums text-muted">{fmtBytes(video.bytes)}</span>
                <button type="button" disabled={busyIds.includes(video.id)} onClick={() => setDeleting(video)} className="sp-button sp-button-quiet text-err"><TrashIcon size={16} aria-hidden="true" />ลบวิดีโอ</button>
                {busyIds.includes(video.id) && <p className="w-full text-xs text-muted">รอให้งานเสร็จก่อนลบวิดีโอ</p>}
              </li>)}
            </ul>
          </section>
        </div>
      </div>
    </div>
    {deleting && <ConfirmDialog title="ลบวิดีโอนี้?" onClose={() => setDeleting(null)} onConfirm={async () => {
      checkResponse(await api.videos({ id: deleting.id }).delete()); setNotice('ลบวิดีโอและงานที่เกี่ยวข้องแล้ว'); await refetch();
    }}><p className="break-words font-semibold text-ink">{deleting.filename}</p><p className="mt-2">สำเนาวิดีโอ คลิป คำบรรยาย และไฟล์ส่งออกที่ ShotPrompt เก็บไว้จะถูกลบถาวร ไฟล์ต้นฉบับนอก ShotPrompt จะยังอยู่</p></ConfirmDialog>}
  </div></AppShell>;
}
