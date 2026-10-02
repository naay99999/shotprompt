'use client';
import type { AiAnalysisOptions } from '@shotprompt/core';
export function AnalysisControls({ value, onChange, disabled = false }: { value: AiAnalysisOptions; onChange: (value: AiAnalysisOptions) => void; disabled?: boolean }) {
  const control = 'w-full min-w-0 rounded-lg border border-line3 bg-bg px-3 py-2 text-ink';
  return <fieldset disabled={disabled} className="min-w-0 space-y-3 text-[14px]">
    <legend className="mb-2 font-semibold">การคัดช่วงด้วย AI</legend>
    <div className="grid grid-cols-2 gap-3">{(['minDuration', 'maxDuration'] as const).map(key => <label key={key} className="block space-y-1"><span>{key === 'minDuration' ? 'สั้นสุด (วินาที)' : 'ยาวสุด (วินาที)'}</span><input type="number" min={5} max={180} step={1} required className={control} value={Number.isNaN(value[key]) ? '' : value[key]} onChange={event => onChange({ ...value, [key]: event.target.value === '' ? NaN : Number(event.target.value) })} /></label>)}</div>
    <label className="block space-y-1"><span>ต้องการคลิปแบบไหน? (ไม่บังคับ)</span><textarea className={control} rows={3} value={value.instruction} onChange={event => onChange({ ...value, instruction: [...event.target.value].slice(0, 500).join('') })} placeholder="เช่น ช่วงที่อธิบายข้อผิดพลาดของมือใหม่ พร้อมวิธีแก้" /></label>
    <label className="block space-y-1"><span>จำนวนคลิปที่แนะนำสูงสุด</span><input type="number" className={control} min={1} max={30} required value={Number.isNaN(value.maxClips) ? '' : value.maxClips} onChange={event => onChange({ ...value, maxClips: event.target.value === '' ? NaN : Number(event.target.value) })} /></label>
    <p className="text-[12px] text-muted">AI อ่านบริบทจากบทถอดเสียงและเลือกช่วงพร้อมเหตุผล จำนวนผลอาจน้อยกว่าที่ขอ</p>
    {(!Number.isFinite(value.minDuration + value.maxDuration) || value.minDuration > value.maxDuration || value.minDuration < 5 || value.maxDuration > 180 || !Number.isInteger(value.maxClips) || value.maxClips < 1 || value.maxClips > 30) && <p role="alert" className="text-err">เลือกความยาว 5–180 วินาที โดยสั้นสุดไม่เกินยาวสุด และจำนวนคลิป 1–30</p>}
  </fieldset>;
}
