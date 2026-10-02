// Serialize edits to a clip; rejected requests must not block subsequent retries.
export function createSaveQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(write: () => Promise<T>): Promise<T> {
    const result = tail.then(write);
    tail = result.catch(() => {});
    return result;
  };
}
export function rangeError(start: number, end: number, duration: number): string | null {
  if (![start, end, duration].every(Number.isFinite) || start < 0 || end > duration || end - start < 2) {
    return 'เลือกเวลาเริ่มและจบภายในวิดีโอ โดยคลิปต้องยาวอย่างน้อย 2 วินาที';
  }
  return null;
}

export type SubtitleDraft = { id?: number; start: number; end: number; text: string };
// Extending a clip adds server rows. Overlay local edits by ID without dropping those rows.
export function mergeSubtitleEdits(current: SubtitleDraft[], draft: SubtitleDraft[], submitted?: SubtitleDraft[] | null): SubtitleDraft[] {
  let rebased = draft;
  const currentIds = new Set(current.map(row => row.id));
  if (draft.some(row => !currentIds.has(row.id))) {
    // A PUT can commit even when its response is lost. Reconcile only against
    // the exact payload we sent, never guess when another writer changed data.
    if (!submitted || submitted.length !== current.length || submitted.some((row, i) =>
      row.start !== current[i].start || row.end !== current[i].end || row.text !== current[i].text)) {
      throw new Error('Subtitle identities changed; reload before saving');
    }
    const ids = new Map(submitted.map((row, i) => [row.id, current[i].id]));
    rebased = draft.map(row => ({ ...row, id: ids.get(row.id) }));
    if (rebased.some(row => row.id == null)) throw new Error('Subtitle identities changed; reload before saving');
  }
  const edits = new Map(rebased.map(row => [row.id, row]));
  return current.map(row => edits.get(row.id) ?? row).sort((a, b) => a.start - b.start);
}
export function subtitleRangeError(rows: SubtitleDraft[], duration: number): string | null {
  return rows.some(row => !Number.isFinite(row.start) || !Number.isFinite(row.end) || row.start < 0 || row.end > duration || row.end <= row.start)
    ? 'เวลาแสดงคำบรรยายต้องอยู่ภายในวิดีโอ และเวลาจบต้องมากกว่าเวลาเริ่ม' : null;
}
