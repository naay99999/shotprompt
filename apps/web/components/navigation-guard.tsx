'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Modal, ErrorNotice } from './ui-feedback';

type Guard = { dirty: boolean; save: () => Promise<boolean>; discard: () => Promise<void> };
const Context = createContext<{ register: (guard: Guard | null) => void; request: (action: () => void) => void }>({ register: () => {}, request: action => action() });
export const useNavigationGuard = () => useContext(Context);
export function NavigationGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const guard = useRef<Guard | null>(null);
  const action = useRef<(() => void) | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const register = useCallback((value: Guard | null) => { guard.current = value; }, []);
  const request = useCallback((next: () => void) => {
    if (!guard.current?.dirty) { next(); return; }
    action.current = next; setError(null); setOpen(true);
  }, []);
  useEffect(() => {
    function unload(event: BeforeUnloadEvent) { if (guard.current?.dirty) { event.preventDefault(); event.returnValue = ''; } }
    function link(event: MouseEvent) {
      if (!guard.current?.dirty || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element)?.closest?.('a');
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin || url.href === location.href) return;
      event.preventDefault(); event.stopPropagation();
      request(() => router.push(url.pathname + url.search + url.hash));
    }
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', link, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', link, true); };
  }, [request, router]);
  useEffect(() => {
    // Keep an index alongside Next's history state to restore a cancelled traversal.
    const key = '__shotpromptHistoryIndex';
    let index = Number(history.state?.[key] ?? 0);
    let restoring = false;
    let replaying = false;
    let pendingDelta = 0;
    const push = history.pushState;
    const replace = history.replaceState;
    replace.call(history, { ...history.state, [key]: index }, '');
    history.pushState = function(state, unused, url) {
      index += 1;
      push.call(this, { ...state, [key]: index }, unused, url);
    };
    history.replaceState = function(state, unused, url) {
      replace.call(this, { ...state, [key]: index }, unused, url);
    };
    function traverse(event: PopStateEvent) {
      const target = event.state?.[key];
      if (typeof target !== 'number') return;
      if (restoring) {
        event.stopImmediatePropagation();
        restoring = false;
        const delta = pendingDelta;
        request(() => { replaying = true; history.go(delta); });
        return;
      }
      if (replaying || !guard.current?.dirty) { replaying = false; index = target; return; }
      const delta = target - index;
      if (!delta) return;
      event.stopImmediatePropagation();
      pendingDelta = delta;
      restoring = true;
      history.go(-delta);
    }
    window.addEventListener('popstate', traverse, true);
    return () => {
      window.removeEventListener('popstate', traverse, true);
      history.pushState = push;
      history.replaceState = replace;
    };
  }, [request]);
  function continueAction() { setOpen(false); const next = action.current; action.current = null; next?.(); }
  return <Context.Provider value={{ register, request }}>{children}{open && <Modal title="มีการแก้ไขที่ยังไม่บันทึก" busy={busy} onClose={() => setOpen(false)}>
    <p className="text-muted">บันทึกการแก้ไขก่อนออกจากคลิปนี้ หรือทิ้งการแก้ไขที่ยังไม่บันทึก</p><ErrorNotice error={error} />
    <div className="mt-5 flex flex-wrap justify-end gap-2">
      <button autoFocus type="button" disabled={busy} onClick={() => setOpen(false)} className="rounded-lg border border-line3 px-3 py-2">กลับไปแก้ต่อ</button>
      <button type="button" disabled={busy} onClick={async () => { setBusy(true); setError(null); try { await guard.current?.discard(); continueAction(); } catch (error) { setError(error); } finally { setBusy(false); } }} className="rounded-lg border border-err/40 px-3 py-2 text-err">ทิ้งการแก้ไข</button>
      <button type="button" disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        try { if (await guard.current?.save()) continueAction(); else setError('บันทึกการแก้ไขไม่สำเร็จ'); }
        catch (error) { setError(error); } finally { setBusy(false); }
      }} className="rounded-lg bg-accent px-3 py-2 font-semibold text-bg">{busy ? 'กำลังบันทึก…' : 'บันทึกและไปต่อ'}</button>
    </div>
  </Modal>}</Context.Provider>;
}
