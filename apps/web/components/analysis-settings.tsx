'use client';
import { useEffect, useState } from 'react';
import { getProviderPresets, type ProfileView, type ProviderConfig } from '@shotprompt/core';
import { useProviderProfiles } from '@/lib/use-provider-profiles';
import { useNavigationGuard } from './navigation-guard';
import { describeError } from '@/lib/ui-error';
import { ErrorNotice, ConfirmDialog } from './ui-feedback';
import { ProviderModelPicker } from './provider-model-picker';

const control = 'w-full min-w-0 rounded-lg border border-line3 bg-bg px-3 py-2 text-ink';
export function AnalysisSettings() {
  const settings = useProviderProfiles(), { register, request: requestNavigation } = useNavigationGuard();
  const [deleting, setDeleting] = useState<ProfileView | null>(null), [notice, setNotice] = useState('');
  const editor = settings.editor, registry = settings.registry;
  useEffect(() => { register({ dirty: editor.dirty, save: async () => { await settings.save(); return true; }, discard: async () => settings.close() }); return () => register(null); }, [editor.dirty, register, settings.close, settings.save]);
  const updateConfig = (patch: Partial<ProviderConfig>) => settings.edit({ ...editor.draft, config: { ...editor.draft.config, ...patch } });
  async function action(run: () => Promise<unknown>, success?: string) { setNotice(''); try { await run(); if (success) setNotice(success); } catch (error) { setNotice(describeError(error).message); } }
  return <section className="space-y-4 rounded-2xl border border-line3 bg-surface p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">การเชื่อมต่อ AI สำหรับคัดช่วงคลิป</h2><p className="mt-1 text-[14px] text-muted">เก็บหลายโปรไฟล์ไว้ได้ เลือกโมเดล ทดสอบ แล้วค่อยตั้งเป็นค่าเริ่มต้น</p></div><button type="button" onClick={() => requestNavigation(() => settings.openNew())} className="rounded-lg bg-accent px-4 py-2 font-semibold text-bg">เพิ่มการเชื่อมต่อ</button></div>
    <ErrorNotice error={settings.error} onRetry={() => void settings.refresh()} />{settings.loading && <p role="status">กำลังโหลดการเชื่อมต่อ…</p>}
    {registry?.migrationNotice && <p className="rounded-lg border border-line3 p-3 text-[13px]">นำเข้าการตั้งค่า AI เดิมแล้ว กรุณาทดสอบการเชื่อมต่ออีกครั้งก่อนใช้งาน</p>}
    {notice && <p role="status" className="text-[13px]">{notice}</p>}
    {registry?.profiles.length === 0 && !editor.dirty && <p className="rounded-lg border border-line3 p-4 text-[14px] text-muted">ยังไม่มีโปรไฟล์ AI เพิ่มการเชื่อมต่อเพื่อเริ่มวิเคราะห์อัตโนมัติ คุณยังเปิดคลิปและตัดต่อด้วยตนเองได้</p>}
    <div className="space-y-2">{registry?.profiles.map(profile => <div key={profile.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line3 p-3">
      <div className="min-w-0 flex-1"><p className="break-words font-semibold">{profile.name}{registry.activeProfileId === profile.id ? ' · ค่าเริ่มต้น' : ''}</p><p className="break-all text-[12px] text-muted">{profile.presetId} · {profile.config.model || 'ยังไม่เลือกโมเดล'} · {profile.check?.status === 'ready' ? 'ทดสอบแล้ว' : profile.keyPresent ? 'ต้องทดสอบใหม่' : profile.credentialMode === 'none' ? 'ยังไม่มี API key' : 'credential ใช้ไม่ได้'}</p>{!profile.vaultAvailable && profile.keyPresent && <p className="text-[12px] text-err">ไม่พบกุญแจ vault สำหรับถอดรหัส API key</p>}</div>
      <button type="button" onClick={() => requestNavigation(() => settings.openEdit(profile))} className="rounded-lg border border-line3 px-3 py-2 text-[13px]">แก้ไข</button>
      <button type="button" disabled={registry.activeProfileId === profile.id || profile.check?.status !== 'ready'} onClick={() => void action(() => settings.activate(profile), 'ตั้งเป็นค่าเริ่มต้นแล้ว')} className="rounded-lg border border-line3 px-3 py-2 text-[13px] disabled:opacity-50">ใช้โปรไฟล์นี้</button>
      <button type="button" onClick={() => setDeleting(profile)} className="rounded-lg border border-line3 px-3 py-2 text-[13px] text-err">ลบ</button>
    </div>)}</div>
    {(editor.dirty || editor.profileId) && <form className="space-y-4 rounded-xl border border-line3 p-4" onSubmit={event => { event.preventDefault(); void action(() => settings.save(), 'บันทึกการตั้งค่าแล้ว'); }}>
      <h3 className="font-semibold">{editor.profileId ? 'แก้ไขโปรไฟล์' : 'เพิ่มโปรไฟล์'}</h3>
      <fieldset disabled={settings.busy} className="space-y-3">
        <label className="block space-y-1"><span>ชื่อโปรไฟล์</span><input required maxLength={80} className={control} value={editor.draft.name} onChange={event => settings.edit({ ...editor.draft, name: event.target.value })} /></label>
        <label className="block space-y-1"><span>ผู้ให้บริการ</span><select className={control} value={editor.draft.presetId} onChange={event => { const preset = settings.presets.find(row => row.id === event.target.value); if (preset) settings.selectPreset(preset); }}>
          {getProviderPresets().map(preset => <option value={preset.id} key={preset.id}>{preset.name}</option>)}
        </select></label>
        <label className="block space-y-1"><span>API key {editor.draft.config.inferenceLocation === 'local' ? '(ถ้าจำเป็น)' : ''}</span><input type="password" autoComplete="new-password" className={control} value={editor.typedKey} onChange={event => settings.setKey(event.target.value)} placeholder={editor.profileId && registry?.profiles.find(row => row.id === editor.profileId)?.keyPresent ? 'มี key ที่บันทึกไว้ · เว้นว่างเพื่อใช้ key เดิม' : 'กรอก API key'} /></label>
        {settings.presets.find(row => row.id === editor.draft.presetId)?.apiKeyUrl && <a className="text-[12px] text-accent underline" href={settings.presets.find(row => row.id === editor.draft.presetId)!.apiKeyUrl!} target="_blank" rel="noreferrer">เปิดหน้าสร้าง API key ของผู้ให้บริการ ↗</a>}
        {editor.profileId && registry?.profiles.find(row => row.id === editor.profileId)?.keyPresent && <button type="button" onClick={() => settings.removeKey()} className="rounded-lg border border-err/40 px-3 py-2 text-[13px] text-err">ลบ API key ที่บันทึกไว้</button>}
        <ProviderModelPicker catalog={editor.catalog} value={editor.draft.config.model} loading={editor.loading === 'catalog'} onLoad={() => void action(() => settings.loadModels(!!editor.catalog))} onChange={model => updateConfig({ model })} />
        {editor.catalog?.entries.find(row => row.id === editor.draft.config.model)?.schemaSupport === 'unsupported' && editor.draft.config.outputMode === 'schema' && <p role="alert" className="text-[13px] text-warn">รายการนี้ระบุว่าไม่รองรับ JSON schema ลองเปลี่ยนรูปแบบผลลัพธ์เป็น JSON แล้วทดสอบอีกครั้ง</p>}
        {editor.draft.config.inferenceLocation === 'external' && <label className="flex items-start gap-2 rounded-lg border border-line3 p-3 text-[13px]"><input type="checkbox" className="mt-1" checked={editor.draft.config.externalEnabled} onChange={event => updateConfig({ externalEnabled: event.target.checked })} /><span>อนุญาตส่งบทถอดเสียงและคำสั่งวิเคราะห์ไปยังบริการภายนอก</span></label>}
        <label className="block space-y-1"><span>รูปแบบผลลัพธ์</span><select className={control} value={editor.draft.config.outputMode} onChange={event => updateConfig({ outputMode: event.target.value as ProviderConfig['outputMode'] })}><option value="schema">JSON schema</option><option value="json">JSON object</option></select></label>
        <details className="rounded-lg border border-line3 p-3"><summary className="cursor-pointer text-[13px]">ตั้งค่าขั้นสูง</summary><div className="mt-3 space-y-3">
          {editor.draft.presetId === 'custom' && <>
            <label className="block space-y-1"><span>โปรโตคอล API</span><select className={control} value={editor.draft.config.protocol} onChange={event => settings.changeDestination({ protocol: event.target.value as ProviderConfig['protocol'], externalEnabled: false })}><option value="openai-compatible">OpenAI-compatible</option><option value="ollama">Ollama</option></select></label>
            <label className="block space-y-1"><span>ตำแหน่งโมเดล</span><select className={control} value={editor.draft.config.inferenceLocation} onChange={event => settings.changeDestination({ inferenceLocation: event.target.value as ProviderConfig['inferenceLocation'], externalEnabled: false })}><option value="local">เครื่องนี้ / เครือข่ายส่วนตัว</option><option value="external">บริการภายนอก</option></select></label>
            {editor.draft.config.inferenceLocation === 'external' && <p className="rounded-lg border border-line3 p-3 text-[12px] text-muted">ระบบจะบล็อกการส่งข้อมูลจนกว่าจะเปิดการอนุญาตด้านล่าง และการเปลี่ยน URL / โปรโตคอลจะล้าง API key ที่พิมพ์ไว้เพื่อป้องกันการส่ง key ไปยังปลายทางผิด</p>}
          </>}
          <label className="block space-y-1"><span>API base URL</span><input type="url" className={control} value={editor.draft.config.baseUrl} onChange={event => settings.changeDestination({ baseUrl: event.target.value })} /></label>
          <div className="grid gap-3 sm:grid-cols-2">{(['requestTimeoutSeconds', 'runTimeoutSeconds'] as const).map(key => <label key={key} className="space-y-1"><span>{key === 'requestTimeoutSeconds' ? 'เวลารอแต่ละคำขอ (วินาที)' : 'เวลารอทั้งงาน (วินาที)'}</span><input type="number" min={key === 'requestTimeoutSeconds' ? 10 : 60} max={key === 'requestTimeoutSeconds' ? 600 : 7200} className={control} value={editor.draft.config[key]} onChange={event => updateConfig({ [key]: Number(event.target.value) })} /></label>)}</div>
        </div></details>
        <div className="flex flex-wrap gap-2"><button type="submit" className="rounded-lg bg-accent px-4 py-2 font-semibold text-bg">บันทึกโปรไฟล์</button><button type="button" disabled={settings.busy || editor.loading === 'check'} onClick={() => void action(async () => { const checked = await settings.check(); if (checked.check?.status !== 'ready') throw { value: { error: checked.check?.errorCode ?? 'provider-unavailable' } }; }, 'ทดสอบการเชื่อมต่อสำเร็จ')} className="rounded-lg border border-line3 px-4 py-2">{editor.loading === 'check' ? 'กำลังทดสอบ…' : 'บันทึกและทดสอบ'}</button><button type="button" onClick={() => requestNavigation(() => settings.close())} className="rounded-lg border border-line3 px-4 py-2">ปิด</button></div>
        {editor.dirty && <p role="status" className="text-[12px] text-muted">มีการแก้ไขที่ยังไม่บันทึก การแก้ไขจะต้องทดสอบใหม่ก่อนเปิดใช้</p>}
        {editor.check && <p role="status" className={`text-[13px] ${editor.check.status === 'ready' ? 'text-ok' : 'text-err'}`}>{editor.check.status === 'ready' ? 'ทดสอบสำเร็จ พร้อมเลือกเป็นค่าเริ่มต้น' : describeError(editor.check.errorCode, 'ทดสอบไม่สำเร็จ').message}</p>}
        {editor.profileId && editor.check?.status === 'ready' && !editor.dirty && <button type="button" onClick={() => void action(async () => { const profile = registry?.profiles.find(row => row.id === editor.profileId); if (profile) await settings.activate({ ...profile, check: editor.check! }); }, 'ตั้งเป็นค่าเริ่มต้นแล้ว')} className="rounded-lg border border-line3 px-4 py-2">ตั้งเป็นค่าเริ่มต้น</button>}
        <p className="text-[11px] text-muted">การทดสอบส่งคำขอตัวอย่างสั้น ๆ ไปยังโมเดล อาจมีค่าใช้บริการตามผู้ให้บริการ</p>
      </fieldset>
    </form>}
    {deleting && <ConfirmDialog title="ลบโปรไฟล์ AI นี้?" onClose={() => setDeleting(null)} onConfirm={async () => { await settings.remove(deleting); setDeleting(null); setNotice('ลบโปรไฟล์แล้ว'); }}><p>{deleting.name}</p><p className="mt-2 text-[13px] text-muted">API key ที่เก็บไว้จะถูกลบด้วย งานที่กำลังใช้โปรไฟล์นี้ต้องเสร็จก่อน</p></ConfirmDialog>}
  </section>;
}
