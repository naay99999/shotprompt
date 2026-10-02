'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import type { SystemInfo } from '@/lib/use-system';
import { TRANSCRIPTION_MODES } from '@/lib/ui-copy';
import { checkResponse } from '@/lib/ui-error';
import { useEvents } from '@/lib/use-events';
import { ErrorNotice, Help } from './ui-feedback';

type Download = { received: number; total: number; busy: boolean; error?: unknown };
export function ModelManager({ system, onChanged }: { system: SystemInfo; onChanged: () => void }) {
  const [downloads, setDownloads] = useState<Record<string, Download>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<unknown>(null);
  useEvents(event => {
    if (event.type !== 'model:download' || typeof event.model !== 'string') return;
    const name = event.model;
    setDownloads(old => ({ ...old, [name]: {
      received: typeof event.received === 'number' ? event.received : old[name]?.received ?? 0,
      total: typeof event.total === 'number' ? event.total : old[name]?.total ?? 0,
      busy: !event.done, error: event.error,
    } }));
    if (event.done) onChanged();
  });
  async function select(name: string) {
    setSaving(true); setError(null); setNotice('');
    try { checkResponse(await api.settings.put({ whisperModel: name })); setNotice('บันทึกรูปแบบเริ่มต้นแล้ว'); onChanged(); }
    catch (error) { setError(error); } finally { setSaving(false); }
  }
  async function download(name: string) {
    setDownloads(old => ({ ...old, [name]: { received: 0, total: 0, busy: true } }));
    try { checkResponse(await api.system.model.download.post({ model: name })); }
    catch (error) { setDownloads(old => ({ ...old, [name]: { received: 0, total: 0, busy: false, error } })); onChanged(); }
  }
  return <fieldset className="space-y-3"><legend className="mb-3 font-semibold">รูปแบบการถอดเสียง</legend>
    <p className="text-[12px] text-muted">เลือกค่าเริ่มต้นสำหรับวิดีโอใหม่ เวลาและความแม่นยำขึ้นอยู่กับเสียงและเครื่องที่ใช้</p>
    {Object.entries(TRANSCRIPTION_MODES).map(([name, info]) => {
      const ready = !!system.models.find(model => model.name === name)?.downloaded;
      const selected = system.model.name === name;
      const dl = downloads[name];
      const pct = dl?.total ? Math.min(100, Math.round(dl.received / dl.total * 100)) : null;
      return <div key={name} className={`rounded-xl border p-4 ${selected ? 'border-accent' : 'border-line3'}`}>
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input type="radio" name="default-transcription-mode" checked={selected} disabled={!ready || saving} onChange={() => void select(name)} />
          <span><span className="font-semibold">{info.label}</span><span className="ml-2 text-[12px] text-muted">{selected ? 'ค่าเริ่มต้น' : ready ? 'พร้อมใช้' : 'ต้องดาวน์โหลดก่อน'}</span><span className="mt-1 block text-[12px] text-muted">{info.description}</span></span>
        </label>
        {!ready && <p className="my-2 text-[12px] text-muted">ดาวน์โหลด {info.size} · ใช้อินเทอร์เน็ตครั้งแรก</p>}
        {!ready && !dl?.busy && <button type="button" className="rounded-lg border border-line3 px-3 py-2 text-accent" onClick={() => void download(name)}>ดาวน์โหลด{info.label}</button>}
        {dl?.busy && <div role="status" className="space-y-2"><p className="text-[12px]">กำลังดาวน์โหลด{pct !== null ? ` ${pct}%` : '…'}</p><progress className="w-full" max={100} value={pct ?? undefined} /></div>}
        <ErrorNotice error={dl?.error} fallback="ดาวน์โหลดไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง" />
        <Help>Whisper {name} · {info.size} · ดาวน์โหลดต่อจากเดิมได้เมื่อเชื่อมต่อใหม่</Help>
      </div>;
    })}
    <ErrorNotice error={error} /><p role="status" className="text-[12px] text-ok">{saving ? 'กำลังบันทึก…' : notice}</p>
  </fieldset>;
}
