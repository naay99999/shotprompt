'use client';
import Link from 'next/link';
import { useSystem } from '@/lib/use-system';
import { isSystemReady } from '@/lib/system-readiness';
export function AppShell({ active, children }: { active: 'library' | 'settings'; children: React.ReactNode }) {
  const { system, loading, error, refresh } = useSystem();
  const ready = !!system && isSystemReady(system);
  return <div className="flex min-h-screen min-w-0 flex-col">
    <a href="#main-content" className="skip-link">ข้ามไปเนื้อหาหลัก</a>
    <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line3 bg-header px-4 py-2 sm:px-5">
      <Link href="/" className="flex items-center gap-2 rounded-lg text-base font-bold"><span aria-hidden="true" className="rounded-lg bg-accent px-2 py-1 text-bg">▶</span>ShotPrompt</Link>
      <nav aria-label="เมนูหลัก" className="flex gap-1">{[['/', 'library', 'คลังวิดีโอ'], ['/settings', 'settings', 'ตั้งค่า']].map(([href, key, label]) => <Link key={key} href={href} aria-current={active === key ? 'page' : undefined} className={`inline-flex items-center rounded-lg px-3 py-2 text-[14px] ${active === key ? 'bg-line2 text-ink' : 'text-muted'}`}>{label}</Link>)}</nav>
      <div className="ml-auto text-[12px] text-muted" role="status">
        {error ? <button type="button" onClick={refresh} className="rounded-lg border border-err/40 px-3 py-2 text-err">เชื่อมต่อระบบไม่ได้ · ลองอีกครั้ง</button> : loading ? 'กำลังตรวจสอบระบบ…' : <Link className="inline-flex items-center rounded-lg px-3 py-2" href={ready ? '/settings' : '/setup'}>{ready ? '✓ พร้อมใช้งาน' : 'เตรียมเครื่องก่อนเริ่มใช้งาน →'}</Link>}
      </div>
    </header>
    <main id="main-content" tabIndex={-1} className="min-w-0 flex-1">{children}</main>
  </div>;
}
