'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ASPECT_LABEL, type Aspect } from '@/lib/format';
import { checkResponse } from '@/lib/ui-error';
import { useSystem } from '@/lib/use-system';
import { ErrorNotice, Help } from './ui-feedback';
import { useNavigationGuard } from './navigation-guard';
import type { Clip } from './clip-strip';
export function ExportBar({ clips, exportSel, onExported }: { clips: Clip[]; exportSel: Record<string, boolean>; onExported: () => void }) {
  const [aspect, setAspect] = useState<Aspect>('9:16');
  const [burnSubtitles, setBurnSubtitles] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const { system, error: systemError, loading, refresh } = useSystem();
  const { request } = useNavigationGuard();
  const exportReady = !!system?.ffmpeg && !!system.libx264;
  const selectedIds = clips.filter(clip => exportSel[clip.id]).map(clip => clip.id);
  useEffect(() => { if (system && !system.libass) setBurnSubtitles(false); }, [system]);
  async function start() {
    if (!selectedIds.length || busy || !exportReady) return;
    setBusy(true); setError(null); setNotice('');
    try { checkResponse(await api.exports.post({ clipIds: selectedIds, aspect, burnSubtitles })); onExported(); setNotice('เริ่มสร้างไฟล์แล้ว ดาวน์โหลดได้จากรายการด้านล่างเมื่อเสร็จ'); }
    catch (error) { setError(error); } finally { setBusy(false); }
  }
  return <section className="space-y-4"><p className="text-[13px] text-muted">เลือกแล้ว {selectedIds.length} คลิป</p>
    <fieldset disabled={busy} className="flex flex-col gap-2"><legend className="mb-2 text-[13px] font-medium">รูปแบบภาพ</legend>{Object.entries(ASPECT_LABEL).map(([value, label]) => <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md bg-bg px-3 text-[13px]"><input type="radio" name="export-aspect" checked={aspect === value} onChange={() => setAspect(value as Aspect)} />{label}</label>)}</fieldset>
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]"><input type="checkbox" checked={burnSubtitles} disabled={busy || !system?.libass} onChange={event => setBurnSubtitles(event.target.checked)} />ใส่คำบรรยายลงในวิดีโอ</label>
    <p className="text-[12px] text-muted">คำบรรยายที่ใส่ลงในภาพจะเปิด–ปิดภายหลังไม่ได้</p>
    {system && exportReady && !system.libass && <p className="text-[12px] text-warn">เครื่องนี้ยังใส่คำบรรยายลงในภาพไม่ได้ คุณยังส่งออกวิดีโอและดาวน์โหลดคำบรรยายแยกได้</p>}
    {system && !exportReady && <p className="text-[12px] text-warn">ติดตั้งเครื่องมือตัดต่อวิดีโอในหน้าเตรียมเครื่องก่อนส่งออก</p>}
    <Help>แนวตั้งเหมาะกับการดูบนมือถือ แนวนอนเหมาะกับจอกว้าง ระบบปรับระดับเสียงให้สม่ำเสมอเมื่อส่งออก</Help>
    <ErrorNotice error={systemError} onRetry={refresh} /><ErrorNotice error={error} fallback="เริ่มสร้างไฟล์ไม่สำเร็จ กรุณาลองอีกครั้ง" />
    <button type="button" disabled={!exportReady || !selectedIds.length || busy || loading || !!systemError} onClick={() => request(() => { void start(); })} className="sp-button sp-button-primary w-full">{busy ? 'กำลังเริ่ม…' : `ส่งออก ${selectedIds.length} คลิป`}</button>
    {!selectedIds.length && <p className="text-[12px] text-muted">เลือกคลิปจากช่องทำเครื่องหมายใน “คลิปของฉัน” ก่อนส่งออก</p>}
    <p role="status" className="text-[14px] text-ok">{notice}</p>
  </section>;
}
