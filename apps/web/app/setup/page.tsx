'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useSystem } from '@/lib/use-system';
import { isSystemReady } from '@/lib/system-readiness';
import { ErrorNotice, Help } from '@/components/ui-feedback';
import { ModelManager } from '@/components/model-manager';
import { SystemSummary } from '@/components/system-summary';

export default function SetupPage() {
  const { system, loading, error, refresh } = useSystem();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<unknown>(null);
  const ready = !!system && !error && isSystemReady(system);
  const guide = system?.installGuide;
  return <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-8">
    <Link href="/" className="w-fit rounded-lg px-3 py-2 text-accent">← คลังวิดีโอ</Link>
    <header><h1 className="text-2xl font-bold">เตรียม ShotPrompt ให้พร้อม</h1><p className="mt-2 text-muted">ตั้งค่าครั้งแรก แล้วเริ่มสร้างคลิปจากวิดีโอของคุณ</p></header>
    <ErrorNotice error={error} onRetry={refresh} />
    {loading && <p role="status">กำลังตรวจสอบเครื่องนี้…</p>}
    {system && <>
      <section className="space-y-4 rounded-2xl border border-line3 bg-surface p-5"><h2 className="text-lg font-semibold">1. เตรียมเครื่องมือ</h2><SystemSummary system={system} />
        {guide && <details><summary className="cursor-pointer py-2 text-accent">วิธีติดตั้งเครื่องมือสำหรับเครื่องนี้</summary>
          <ol className="list-decimal space-y-3 pl-5 text-[14px] text-muted">
            <li>เปิด {guide.platform === 'windows' ? 'PowerShell จากเมนูเริ่ม' : guide.platform === 'macos' ? 'Terminal จาก Spotlight (กด Command + Space แล้วพิมพ์ Terminal)' : 'Terminal จากเมนูแอปพลิเคชัน'}</li>
            <li>คัดลอกคำสั่งด้านล่าง วางในหน้าต่างที่เปิด แล้วกด Enter<pre className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-bg p-3 font-mono text-[12px]">{guide.commands.join('\n') || 'ดูคู่มือติดตั้งสำหรับระบบนี้'}</pre>
              {!!guide.commands.length && <button type="button" className="mt-2 rounded-lg border border-line3 px-3 py-2" onClick={async () => { setCopyError(null); setCopied(false); try { await navigator.clipboard.writeText(guide.commands.join('\n')); setCopied(true); } catch (error) { setCopyError(error); } }}>{copied ? 'คัดลอกแล้ว' : 'คัดลอกคำสั่ง'}</button>}
            </li><li>รอจนติดตั้งเสร็จ จากนั้นปิดและเปิด ShotPrompt ใหม่ แล้วกดตรวจสอบอีกครั้ง</li>
          </ol>
          <p className="mt-3 text-[14px] text-muted">{guide.note}</p>
          <a href={guide.manualUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center text-accent">เปิดคู่มือติดตั้ง (แท็บใหม่) ↗</a>
          <Help>ระบบ: {guide.platform} · {guide.architecture} · {guide.manager} · PATH คือตำแหน่งที่เครื่องค้นหาโปรแกรมที่ติดตั้ง</Help>
          <ErrorNotice error={copyError} fallback="คัดลอกไม่สำเร็จ คุณสามารถเลือกข้อความคำสั่งแล้วคัดลอกเองได้" />
        </details>}
      </section>
      <section className="rounded-2xl border border-line3 bg-surface p-5"><h2 className="mb-4 text-lg font-semibold">2. เตรียมไฟล์ถอดเสียง</h2><ModelManager system={system} onChanged={refresh} /></section>
      <section className="space-y-3 rounded-2xl border border-line3 bg-surface p-5"><h2 className="text-lg font-semibold">3. เริ่มสร้างคลิป</h2>
        <p className="text-[14px] text-muted">{ready ? 'เครื่องนี้พร้อมใช้งานแล้ว เพิ่มวิดีโอเพื่อเริ่มถอดเสียงและหาช่วงที่น่าสนใจ' : 'ทำขั้นตอนด้านบนให้พร้อม แล้วตรวจสอบอีกครั้ง'}</p>
        <button type="button" disabled={loading} onClick={refresh} className="rounded-lg border border-line3 px-4 py-2">{loading ? 'กำลังตรวจสอบ…' : 'ตรวจสอบอีกครั้ง'}</button>
        {ready && <Link href="/" className="ml-2 inline-flex items-center rounded-lg bg-accent px-4 py-2 font-semibold text-bg">เริ่มใช้งาน →</Link>}
      </section>
    </>}
  </main>;
}
