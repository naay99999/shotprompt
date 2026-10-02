'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { describeError } from '@/lib/ui-error';

export function Help({ children, label = 'รายละเอียดเพิ่มเติม' }: { children: ReactNode; label?: string }) {
  return <details className="help-details text-[12px] text-muted" onKeyDown={event => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.currentTarget.open = false;
      event.currentTarget.querySelector('summary')?.focus();
    }
  }}><summary className="cursor-pointer rounded-md py-2">{label}</summary><div className="mt-1 rounded-lg border border-line3 bg-surface2 p-3 leading-relaxed">{children}</div></details>;
}

export function ErrorNotice({ error, fallback, onRetry }: { error: unknown; fallback?: string; onRetry?: () => void }) {
  if (!error) return null;
  const info = describeError(error, fallback);
  return <div role="alert" className="rounded-lg border border-err/40 bg-err/5 p-3 text-[14px] text-err">
    <p>{info.message}</p>
    {onRetry && <button type="button" onClick={onRetry} className="mt-2 rounded-lg border border-err/40 px-3 py-2">ลองอีกครั้ง</button>}
    {info.details && info.details !== info.message && <Help label="ดูรายละเอียดทางเทคนิค"><pre className="whitespace-pre-wrap break-all font-mono text-[12px]">{info.details}</pre></Help>}
  </div>;
}

export function Modal({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} aria-labelledby={titleId} aria-busy={busy} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-2xl border border-line3 bg-surface p-5 text-ink shadow-2xl backdrop:bg-black/70">
    <h2 id={titleId} className="mb-3 text-lg font-semibold">{title}</h2>{children}
  </dialog>;
}

export function ConfirmDialog({ title, children, confirmLabel = 'ยืนยันลบ', onConfirm, onClose }: {
  title: string; children: ReactNode; confirmLabel?: string; onConfirm: () => Promise<void>; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return <Modal title={title} onClose={onClose} busy={busy}>
    <div className="text-[14px] leading-relaxed text-muted">{children}</div><ErrorNotice error={error} />
    <div className="mt-5 flex flex-wrap justify-end gap-2">
      <button autoFocus type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-line3 px-4 py-2">ยกเลิก</button>
      <button type="button" disabled={busy} className="rounded-lg bg-err px-4 py-2 font-semibold text-bg" onClick={async () => {
        setBusy(true); setError(null);
        try { await onConfirm(); onClose(); } catch (error) { setError(error); } finally { setBusy(false); }
      }}>{busy ? 'กำลังดำเนินการ…' : confirmLabel}</button>
    </div>
  </Modal>;
}
