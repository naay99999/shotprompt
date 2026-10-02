'use client';
import { TRANSCRIPTION_MODES } from '@/lib/ui-copy';
import { getAvailableWhisperModels, type WhisperOptions, type WhisperModel } from '@/lib/whisper-options';
import { Help } from './ui-feedback';

export function TranscriptionSelect({ options, value, onChange, disabled = false }: {
  options: WhisperOptions | null; value: WhisperModel | null; onChange: (value: WhisperModel) => void; disabled?: boolean;
}) {
  return <div className="min-w-0 w-full max-w-sm">
    <label className="flex flex-col gap-2 text-[14px]">รูปแบบการถอดเสียง
      <select value={value ?? ''} onChange={event => onChange(event.currentTarget.value as WhisperModel)} disabled={disabled || !options}
        className="w-full rounded-lg border border-line3 bg-surface2 px-3 py-2 text-ink">
        {!value && <option value="">ยังไม่มีรูปแบบที่พร้อมใช้</option>}
        {options && getAvailableWhisperModels(options).map(option => <option key={option.name} value={option.name} disabled={!option.downloaded}>
          {TRANSCRIPTION_MODES[option.name].label}{!option.downloaded ? ' · ต้องดาวน์โหลดก่อน' : ''}
        </option>)}
      </select>
    </label>
    {value && <p className="mt-1 text-[12px] text-muted">{TRANSCRIPTION_MODES[value].description}</p>}
    <Help label="เลือกแบบไหนดี?">เวลาและความแม่นยำขึ้นอยู่กับเสียงและเครื่องที่ใช้
      <ul className="mt-2 space-y-2">{Object.entries(TRANSCRIPTION_MODES).map(([name, info]) => <li key={name}>{info.label}: {info.description} · Whisper {name} · ดาวน์โหลด {info.size}</li>)}</ul>
    </Help>
  </div>;
}
