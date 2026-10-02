'use client';
import { useMemo, useState } from 'react';
import type { ModelCatalog } from '@shotprompt/core';
import { filterModels } from '@/lib/provider-profile-state';

function price(value: number | null): string { return value === null ? 'ราคาไม่ทราบ' : value === 0 ? 'ฟรี' : `$${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}/1M tokens`; }
export function ProviderModelPicker({ catalog, value, loading, onLoad, onChange }: { catalog: ModelCatalog | null; value: string; loading: boolean; onLoad: () => void; onChange: (value: string) => void }) {
  const [query, setQuery] = useState(''), [schemaOnly, setSchemaOnly] = useState(false);
  const rows = useMemo(() => filterModels(catalog?.entries ?? [], query, schemaOnly), [catalog, query, schemaOnly]);
  return <div className="space-y-2">
    <label className="block space-y-1"><span>ชื่อโมเดล</span><input className="w-full min-w-0 rounded-lg border border-line3 bg-bg px-3 py-2 text-ink" value={value} onChange={event => onChange(event.target.value)} placeholder="พิมพ์ชื่อเองได้ หรือเลือกรายการด้านล่าง" /></label>
    <div className="flex flex-wrap items-center gap-3"><button type="button" disabled={loading} onClick={onLoad} className="rounded-lg border border-line3 px-3 py-2">{loading ? 'กำลังโหลดโมเดล…' : catalog ? 'โหลดรายการใหม่' : 'โหลดรายการโมเดล'}</button>
      <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={schemaOnly} onChange={event => setSchemaOnly(event.target.checked)} />แสดงเฉพาะที่ระบุว่ารองรับ JSON schema</label>
    </div>
    {catalog && <label className="block space-y-1"><span className="text-[12px]">ค้นหาในรายการโมเดล</span><input className="w-full min-w-0 rounded-lg border border-line3 bg-bg px-3 py-2 text-ink" value={query} onChange={event => setQuery(event.target.value)} placeholder="ค้นหาด้วยชื่อหรือ model ID" /></label>}
    {catalog?.stale && <p role="status" className="text-[12px] text-warn">โหลดข้อมูลล่าสุดไม่สำเร็จ กำลังแสดงรายการเก่าที่อาจไม่ตรงกับผู้ให้บริการ</p>}
    {catalog?.truncated && <p className="text-[12px] text-muted">รายการถูกจำกัดจำนวนเพื่อให้ค้นหาได้เร็ว กรุณาพิมพ์ชื่อโมเดลเองหากหาไม่พบ</p>}
    {catalog && <div className="max-h-56 overflow-auto rounded-lg border border-line3" role="listbox" aria-label="รายการโมเดล">
      {rows.length === 0 ? <p className="p-3 text-[13px] text-muted">ไม่พบโมเดลที่ตรงกัน สามารถใช้ชื่อที่พิมพ์ไว้ได้</p> : rows.map(row => <button key={row.id} type="button" role="option" aria-selected={value === row.id} onClick={() => onChange(row.id)} className={`block w-full border-b border-line3 p-3 text-left last:border-0 hover:bg-line1 ${value === row.id ? 'bg-line1' : ''}`}>
        <span className="block break-all text-[13px] font-semibold">{row.name}</span><span className="block break-all text-[11px] text-muted">{row.id} · context {row.contextLength ?? 'ไม่ทราบ'} · input {price(row.inputUsdPerMillion)} · output {price(row.outputUsdPerMillion)}</span><span className="block text-[11px] text-muted">JSON schema: {row.schemaSupport === 'supported' ? 'รองรับ' : row.schemaSupport === 'unsupported' ? 'ไม่รองรับ' : 'ไม่ทราบ'}</span>
      </button>)}
    </div>}
  </div>;
}
