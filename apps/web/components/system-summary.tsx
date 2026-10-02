'use client';
import type { SystemInfo } from '@/lib/use-system';
import { Help } from './ui-feedback';
export function SystemSummary({ system }: { system: SystemInfo }) {
  const rows = [
    ['เตรียมและตัดต่อวิดีโอ', system.ffmpeg && system.ffprobe && system.libx264],
    ['ถอดเสียงเป็นข้อความ', system.whisper],
    ['ใส่คำบรรยายลงในวิดีโอ', system.libass],
  ] as const;
  return <div className="space-y-2">
    {rows.map(([name, ok]) => <p key={name} className="flex flex-wrap justify-between gap-2 text-[14px]"><span>{name}</span><span className={ok ? 'text-ok' : 'text-warn'}>{ok ? '✓ พร้อมใช้งาน' : 'ต้องติดตั้งเพิ่มเติม'}</span></p>)}
    {!system.libass && system.ffmpeg && system.libx264 && <p className="text-[12px] text-muted">ยังส่งออกวิดีโอโดยไม่ใส่คำบรรยายได้</p>}
    <Help label="รายละเอียดระบบ"><ul className="space-y-1">{(['ffmpeg', 'ffprobe', 'whisper', 'libx264', 'libass'] as const).map(name => <li key={name}>{name === 'whisper' ? 'whisper-cli' : name}: {system[name] ? 'ตรวจพบในเครื่อง' : 'ยังไม่พร้อมใช้งาน'}</li>)}<li>การเร่งด้วย GPU: ยังไม่ยืนยัน</li><li>ShotPrompt v0.1 · ระบบในเครื่อง 127.0.0.1</li></ul></Help>
  </div>;
}
