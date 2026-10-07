export function exportSelectionForWorkspace(
  clips: { id: string }[],
  selected: Record<string, boolean>,
  activeId: string | null,
): Record<string, boolean> {
  const batch = clips.filter(clip => selected[clip.id]);
  if (batch.length) return Object.fromEntries(batch.map(clip => [clip.id, true]));
  return activeId && clips.some(clip => clip.id === activeId) ? { [activeId]: true } : {};
}
