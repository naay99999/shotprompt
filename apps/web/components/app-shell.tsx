'use client';
import Link from 'next/link';
import { useSystem } from '@/lib/use-system';
import { isSystemReady } from '@/lib/system-readiness';
import { FilmStrip, GearSix, SquaresFour, ArrowRight, ArrowClockwise } from '@phosphor-icons/react';
import { MotionScope } from './motion-scope';
export function AppShell({ active, children, workspace = false }: { active: 'library' | 'settings'; children: React.ReactNode; workspace?: boolean }) {
  const { system, loading, error, refresh } = useSystem();
  const ready = !!system && isSystemReady(system);
  return <MotionScope><div className={`sp-shell ${workspace ? 'sp-shell-workspace' : ''}`}>
    <a href="#main-content" className="skip-link">ข้ามไปเนื้อหาหลัก</a>
    <header className="sp-app-header">
      <Link href="/" className="sp-brand"><span aria-hidden="true" className="sp-brand-mark"><FilmStrip size={19} weight="bold" /></span>ShotPrompt</Link>
      <nav aria-label="เมนูหลัก" className="sp-nav">{[['/', 'library', 'คลังวิดีโอ'], ['/settings', 'settings', 'ตั้งค่า']].map(([href, key, label]) => <Link key={key} href={href} aria-current={active === key ? 'page' : undefined} className="sp-nav-link">{key === 'library' ? <SquaresFour size={17} aria-hidden="true" /> : <GearSix size={17} aria-hidden="true" />}{label}</Link>)}</nav>
      <div className="ml-auto" role="status">
        {error ? <button type="button" onClick={refresh} className="sp-button sp-button-quiet text-err"><ArrowClockwise size={15} aria-hidden="true" />เชื่อมต่อไม่ได้ · ลองอีกครั้ง</button> : loading ? <span className="sp-system-link">กำลังตรวจสอบระบบ…</span> : <Link className="sp-system-link" href={ready ? '/settings' : '/setup'}><span className="sp-status-dot" data-ready={ready} />{ready ? 'พร้อมใช้งานในเครื่อง' : 'เตรียมเครื่อง'}{!ready && <ArrowRight size={14} aria-hidden="true" />}</Link>}
      </div>
    </header>
    <main id="main-content" tabIndex={-1} className="sp-main">{children}</main>
  </div></MotionScope>;
}
