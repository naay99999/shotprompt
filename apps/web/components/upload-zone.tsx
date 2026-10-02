'use client';
import Link from 'next/link';
import { parseAiAnalysisOptions, type AiAnalysisOptions } from '@shotprompt/core';
import { AnalysisControls } from './analysis-controls';
import { useEffect, useRef, useState } from 'react';
import { api, API_BASE } from '@/lib/api';
import { useSystem } from '@/lib/use-system';
import { checkResponse } from '@/lib/ui-error';
import { getPreferredWhisperModel, type WhisperModel } from '@/lib/whisper-options';
import { ErrorNotice, Help } from './ui-feedback';
import { TranscriptionSelect } from './transcription-select';

export function UploadZone({ onUploaded }: { onUploaded?: () => void }) {
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
      if (xhr.status >= 200 && xhr.status < 300) { onUploaded?.(); return; }
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
    try { checkResponse(await api.videos.post({ path: path.trim(), language, model, analysisOptions })); setPath(''); onUploaded?.(); }
    catch (error) { setError(error); } finally { finish(); }
  }
  return <section aria-label="เพิ่มวิดีโอ" className={`space-y-4 rounded-2xl border-2 border-dashed p-4 sm:p-7 ${dragOver ? 'border-accent' : 'border-line3'}`}
    onDragOver={event => { event.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={event => { event.preventDefault(); setDragOver(false); const file = event.dataTransfer.files[0]; if (file) upload(file); }}>
    <div><h2 className="text-lg font-semibold">เพิ่มวิดีโอ</h2><p className="mt-1 text-[14px] text-muted">เลือกไฟล์หรือลากมาวางที่นี่ รองรับ MP4, MOV และ MKV ครั้งละ 1 ไฟล์</p></div>
    <ErrorNotice error={loadError} onRetry={refresh} />
    {loading && <p role="status">กำลังโหลดตัวเลือกถอดเสียง…</p>}
    <div className="flex flex-wrap items-start gap-5">
      <label className="flex w-full max-w-sm flex-col gap-2 text-[14px]">ภาษาที่พูดในวิดีโอ<select value={language} disabled={!system || busy} onChange={event => setLanguage(event.target.value)} className="min-w-0 rounded-lg border border-line3 bg-surface px-3 py-2 text-ink">
        {(system?.languages ?? []).map(option => <option key={option.code} value={option.code}>{option.name}</option>)}
      </select></label>
      <TranscriptionSelect options={system} value={model} onChange={setModel} disabled={busy} />
    </div>
    <details className="rounded-lg border border-line3 p-3"><summary className="cursor-pointer text-[14px]">ตั้งค่าการคัดช่วงเด่น</summary><div className="mt-3 max-w-lg"><AnalysisControls value={analysisOptions} onChange={value => { analysisDirty.current = true; setAnalysisOptions(value); }} disabled={busy} /></div></details>
    <p className="text-[12px] text-muted">ตั้งค่าโมเดล AI เพื่อคัดช่วงหลังถอดเสียง หากยังไม่ได้ตั้งค่า วิดีโอจะพร้อมให้ตัดต่อและวิเคราะห์ภายหลัง <Link href="/settings" className="text-accent underline">ตั้งค่า AI →</Link></p>
    {!ready && !loading && !loadError && <p className="text-[14px] text-muted">{toolsReady ? 'ดาวน์โหลดไฟล์ถอดเสียงก่อนเริ่มงาน' : 'เตรียมเครื่องให้พร้อมก่อนเพิ่มวิดีโอ'} <Link href="/setup" className="text-accent underline">เตรียมเครื่อง →</Link></p>}
    <input ref={input} type="file" accept=".mp4,.mov,.mkv" className="hidden" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) upload(file); }} />
    <button type="button" disabled={!ready || busy} onClick={() => input.current?.click()} className="rounded-lg bg-accent px-5 py-2 font-semibold text-bg">เลือกไฟล์วิดีโอ</button>
    <p className="text-[12px] text-muted">เมื่อเลือกไฟล์แล้ว ระบบจะนำเข้าและเริ่มถอดเสียงอัตโนมัติ</p>
    {busy && <div role="status" className="space-y-2"><p className="break-words text-[14px]">กำลังนำเข้า {filename}{progress !== null ? ` · ${progress}%` : ''}</p><progress className="w-full" max={100} value={progress ?? undefined} /><p className="text-[12px] text-muted">เปิดหน้านี้ไว้จนกว่านำเข้าเสร็จ แล้วระบบจะเริ่มประมวลผลในเครื่อง</p></div>}
    <ErrorNotice error={error} fallback="นำเข้าวิดีโอไม่สำเร็จ ตรวจสอบว่าเป็นไฟล์ MP4, MOV หรือ MKV แล้วลองอีกครั้ง" />
    <details><summary className="cursor-pointer py-2 text-[14px] text-muted">ตัวเลือกเพิ่มเติม</summary><form className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); void submitPath(); }}>
      <label className="flex flex-col gap-2 text-[14px]">ระบุตำแหน่งไฟล์<input value={path} onChange={event => setPath(event.target.value)} disabled={busy} placeholder={system?.installGuide.platform === 'windows' ? 'C:\\Users\\you\\Videos\\video.mp4' : '/Users/you/Videos/video.mp4'} className="w-full min-w-0 rounded-lg border border-line3 bg-surface px-3 py-2" /></label>
      <p className="text-[12px] text-muted">เหมาะกับไฟล์ใหญ่ ระบบจะคัดลอกไฟล์จากตำแหน่งนี้มาเก็บใน ShotPrompt</p>
      <Help label="หาตำแหน่งไฟล์ได้อย่างไร?">{system?.installGuide.platform === 'windows' ? 'กด Shift ค้างแล้วคลิกขวาที่ไฟล์ เลือกคัดลอกเป็นเส้นทาง แล้วนำเครื่องหมายคำพูดที่ครอบเส้นทางออกก่อนวาง' : system?.installGuide.platform === 'macos' ? 'เลือกไฟล์ใน Finder แล้วกด Option + Command + C เพื่อคัดลอกตำแหน่งไฟล์' : 'เปิดคุณสมบัติของไฟล์ในตัวจัดการไฟล์ แล้วคัดลอกตำแหน่งแบบเต็มรวมชื่อไฟล์'}</Help>
      <button type="submit" disabled={busy || !ready || !path.trim()} className="rounded-lg border border-line3 px-4 py-2">เพิ่มวิดีโอจากตำแหน่งนี้</button>
    </form></details>
  </section>;
}
