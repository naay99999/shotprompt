'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { UploadSimple, CaretDown, SlidersHorizontal } from '@phosphor-icons/react';
import { parseAiAnalysisOptions, type AiAnalysisOptions } from '@shotprompt/core';
import { AnalysisControls } from './analysis-controls';
import { useEffect, useRef, useState } from 'react';
import { api, API_BASE } from '@/lib/api';
import { useSystem } from '@/lib/use-system';
import { checkResponse } from '@/lib/ui-error';
import { getPreferredWhisperModel, type WhisperModel } from '@/lib/whisper-options';
import { ErrorNotice, Help } from './ui-feedback';
import { TranscriptionSelect } from './transcription-select';
import { getImportedVideoId } from '@/lib/upload-result';

export function UploadZone({ onUploaded }: { onUploaded?: () => void }) {
  const router = useRouter();
  const { system, error: loadError, loading, refresh } = useSystem();
  const [analysisOptions, setAnalysisOptions] = useState<AiAnalysisOptions>(() => parseAiAnalysisOptions(undefined));
  const analysisDirty = useRef(false);
  useEffect(() => { let alive = true; api.analysis.profiles.get().then(response => { if (alive && response.data && !analysisDirty.current) setAnalysisOptions(response.data.defaults); }); return () => { alive = false; }; }, []);
  const [language, setLanguage] = useState('th');
  const [model, setModel] = useState<WhisperModel | null>(null);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [filename, setFilename] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [dragOver, setDragOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<XMLHttpRequest | null>(null);
  const busyRef = useRef(false);
  useEffect(() => { if (system) setModel(previous => getPreferredWhisperModel(system, previous ?? system.model.name)); }, [system]);
  useEffect(() => () => { request.current?.abort(); }, []);
  const toolsReady = !!system?.ffmpeg && !!system.ffprobe && !!system.whisper && !!system.libx264;
  const ready = toolsReady && !!model && !loadError && !!system?.models.some(option => option.name === model && option.downloaded);
  function imported(result: unknown) {
    const videoId = getImportedVideoId(result);
    onUploaded?.();
    if (!videoId) throw new Error('นำเข้าแล้วแต่ไม่พบรหัสวิดีโอในคำตอบของระบบ กรุณาตรวจรายการวิดีโอ');
    router.push(`/videos/${videoId}`);
  }
  function finish() { busyRef.current = false; setBusy(false); request.current = null; }
  function upload(file: File) {
    if (busyRef.current) return;
    if (!ready || !model) { setError(!toolsReady ? 'system not ready' : 'model not downloaded'); return; }
    if (!/\.(mp4|mov|mkv)$/i.test(file.name)) { setError(new Error('เลือกไฟล์วิดีโอ MP4, MOV หรือ MKV')); return; }
    try { parseAiAnalysisOptions(analysisOptions); } catch (error) { setError(error); return; }
    setError(null); busyRef.current = true; setBusy(true); setProgress(0); setFilename(file.name);
    const form = new FormData(); form.append('file', file); form.append('language', language); form.append('model', model); form.append('analysisOptions', JSON.stringify(analysisOptions));
    const xhr = new XMLHttpRequest(); request.current = xhr; xhr.timeout = 0;
    xhr.upload.onprogress = event => { if (event.lengthComputable) setProgress(Math.round(event.loaded / event.total * 100)); };
    xhr.onload = () => {
      finish();
      if (xhr.status >= 200 && xhr.status < 300) {
        try { imported(xhr.responseText); } catch (error) { setError(error); }
        return;
      }
      let value: unknown = xhr.responseText;
      try { value = JSON.parse(xhr.responseText); } catch { /* retain details */ }
      setError({ status: xhr.status, value });
    };
    xhr.onerror = () => { finish(); setError(new Error('Failed to fetch')); };
    xhr.onabort = finish;
    xhr.open('POST', `${API_BASE}/videos`); xhr.send(form);
  }
  async function submitPath() {
    if (busyRef.current || !path.trim() || !ready || !model) return;
    try { parseAiAnalysisOptions(analysisOptions); } catch (error) { setError(error); return; }
    busyRef.current = true; setBusy(true); setError(null); setFilename('วิดีโอจากตำแหน่งไฟล์'); setProgress(null);
    try { const response = checkResponse(await api.videos.post({ path: path.trim(), language, model, analysisOptions })); imported(response.data); setPath(''); }
    catch (error) { setError(error); } finally { finish(); }
  }
  return <section aria-label="เพิ่มวิดีโอ" aria-busy={busy} className={`sp-panel min-w-0 space-y-4 p-5 transition-colors sm:p-6 ${dragOver ? 'border-accent bg-accent/5' : ''}`}
    onDragOver={event => { event.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={event => { event.preventDefault(); setDragOver(false); const file = event.dataTransfer.files[0]; if (file) upload(file); }}>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 flex-1"><h2 className="sp-section-title">เพิ่มวิดีโอ</h2><p className="mt-2 text-[13px] leading-relaxed text-muted">ลากไฟล์มาวาง หรือเลือกจากเครื่อง<br />MP4, MOV, MKV · ครั้งละ 1 ไฟล์</p></div>
      <button type="button" disabled={!ready || busy} onClick={() => input.current?.click()} className="sp-button sp-button-primary"><UploadSimple size={18} aria-hidden="true" />เลือกไฟล์</button>
    </div>
    <ErrorNotice error={loadError} onRetry={refresh} />
    {loading && <p role="status">กำลังโหลดตัวเลือกถอดเสียง…</p>}
    <p className="text-[12px] leading-relaxed text-dim">นำเข้าแล้วเริ่มถอดเสียงอัตโนมัติ · {system?.languages.find(option => option.code === language)?.name ?? 'ภาษาไทย'}{model ? ` · Whisper ${model}` : ''}</p>
    {!ready && !loading && !loadError && <p className="text-[14px] text-muted">{toolsReady ? 'ดาวน์โหลดไฟล์ถอดเสียงก่อนเริ่มงาน' : 'เตรียมเครื่องให้พร้อมก่อนเพิ่มวิดีโอ'} <Link href="/setup" className="text-accent underline">เตรียมเครื่อง →</Link></p>}
    <input ref={input} type="file" accept=".mp4,.mov,.mkv" className="hidden" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) upload(file); }} />
    {busy && <div role="status" className="space-y-2"><p className="break-words text-[14px]">กำลังนำเข้า {filename}{progress !== null ? ` · ${progress}%` : ''}</p><progress className="w-full" max={100} value={progress ?? undefined} /><p className="text-[12px] text-muted">เปิดหน้านี้ไว้จนกว่านำเข้าเสร็จ แล้วระบบจะเริ่มประมวลผลในเครื่อง</p></div>}
    <ErrorNotice error={error} fallback="นำเข้าวิดีโอไม่สำเร็จ ตรวจสอบว่าเป็นไฟล์ MP4, MOV หรือ MKV แล้วลองอีกครั้ง" />
    <details className="group border-t border-line pt-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] text-muted [&::-webkit-details-marker]:hidden"><SlidersHorizontal size={16} aria-hidden="true" />การถอดเสียงและ AI<CaretDown size={14} aria-hidden="true" className="ml-auto transition-transform group-open:rotate-180" /></summary>
      <div className="mt-4 space-y-5">
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-2 text-[14px]">ภาษาที่พูดในวิดีโอ<select value={language} disabled={!system || busy} onChange={event => setLanguage(event.target.value)} className="sp-field min-w-0">
            {(system?.languages ?? []).map(option => <option key={option.code} value={option.code}>{option.name}</option>)}
          </select></label>
          <TranscriptionSelect options={system} value={model} onChange={setModel} disabled={busy} />
        </div>
        <div className="border-t border-line pt-4"><AnalysisControls value={analysisOptions} onChange={value => { analysisDirty.current = true; setAnalysisOptions(value); }} disabled={busy} /></div>
        <p className="text-[12px] leading-relaxed text-muted">ตั้งค่าโมเดล AI เพื่อคัดช่วงหลังถอดเสียง หากยังไม่ได้ตั้งค่า คุณจะตัดต่อและวิเคราะห์ภายหลังได้เมื่อประมวลผลเสร็จ <Link href="/settings" className="text-accent underline underline-offset-4">ตั้งค่า AI →</Link></p>
      </div>
    </details>
    <details className="group"><summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] text-muted [&::-webkit-details-marker]:hidden">นำเข้าจากตำแหน่งไฟล์<CaretDown size={14} aria-hidden="true" className="ml-auto transition-transform group-open:rotate-180" /></summary><form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); void submitPath(); }}>
      <label className="flex flex-col gap-2 text-[14px]">ระบุตำแหน่งไฟล์<input value={path} onChange={event => setPath(event.target.value)} disabled={busy} placeholder={system?.installGuide.platform === 'windows' ? 'C:\\Users\\you\\Videos\\video.mp4' : '/Users/you/Videos/video.mp4'} className="sp-field w-full min-w-0" /></label>
      <p className="text-[12px] text-muted">เหมาะกับไฟล์ใหญ่ ระบบจะคัดลอกไฟล์จากตำแหน่งนี้มาเก็บใน ShotPrompt</p>
      <Help label="หาตำแหน่งไฟล์ได้อย่างไร?">{system?.installGuide.platform === 'windows' ? 'กด Shift ค้างแล้วคลิกขวาที่ไฟล์ เลือกคัดลอกเป็นเส้นทาง แล้วนำเครื่องหมายคำพูดที่ครอบเส้นทางออกก่อนวาง' : system?.installGuide.platform === 'macos' ? 'เลือกไฟล์ใน Finder แล้วกด Option + Command + C เพื่อคัดลอกตำแหน่งไฟล์' : 'เปิดคุณสมบัติของไฟล์ในตัวจัดการไฟล์ แล้วคัดลอกตำแหน่งแบบเต็มรวมชื่อไฟล์'}</Help>
      <button type="submit" disabled={busy || !ready || !path.trim()} className="sp-button sp-button-quiet">เพิ่มวิดีโอจากตำแหน่งนี้</button>
    </form></details>
  </section>;
}
