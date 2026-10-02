import type { AnalysisInput, HighlightWindow } from './analysis-types';

export function buildHighlightWindows(input: AnalysisInput): HighlightWindow[] {
  const { duration, options } = input;
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const segments = input.segments.filter(s => Number.isFinite(s.start + s.end) && s.end > s.start && s.end > 0 && s.start < duration)
    .map(s => ({ ...s, start: Math.max(0, s.start), end: Math.min(duration, s.end) })).sort((a, b) => a.start - b.start || a.id - b.id);
  const scenes = input.scenes.filter(t => Number.isFinite(t) && t >= 0 && t < duration);
  if (!segments.length && !scenes.length) return [];
  const longStarts = segments.flatMap(segment => {
    if (segment.end - segment.start <= options.maxDuration) return [];
    const count = Math.min(100, Math.ceil((segment.end - segment.start) / options.maxDuration));
    return Array.from({ length: count }, (_, index) => segment.start + (segment.end - options.maxDuration - segment.start) * index / (count - 1));
  });
  const starts = [...new Set([...segments.map(s => s.start), ...longStarts, ...scenes])].sort((a, b) => a - b);
  // Sample starts throughout the source BEFORE expanding windows: never truncate the tail of long videos.
  const buckets = Array.from({ length: 100 }, () => [] as number[]);
  for (const start of starts) buckets[Math.min(99, Math.floor(start / duration * 100))].push(start);
  const sampled = buckets.flatMap(b => b.length <= 2 ? b : [b[0], b[b.length - 1]]);
  const rows = new Map<string, HighlightWindow>();
  for (const anchor of sampled) {
    for (const target of [options.minDuration, options.maxDuration]) {
      let start = Math.max(0, anchor - 0.25);
      const previous = segments.findLast(s => s.start < anchor && s.end >= anchor - 1.5);
      if (previous && anchor - previous.start + target <= options.maxDuration) start = Math.max(0, previous.start - 0.25);
      if (anchor + target >= duration && duration - start > options.maxDuration) start = Math.max(0, duration - options.maxDuration);
      const cap = Math.min(duration, start + options.maxDuration);
      const minEnd = Math.min(duration, start + options.minDuration);
      const desired = Math.min(cap, start + target);
      const possible = segments.filter(s => s.end >= minEnd && s.end <= cap);
      let end = possible.length ? possible.reduce((a, b) => Math.abs(a.end - desired) <= Math.abs(b.end - desired) ? a : b).end : desired;
      end = Math.min(cap, end + 0.5);
      if (duration < options.minDuration) { start = 0; end = duration; }
      if (end <= start || (end - start < options.minDuration && duration >= options.minDuration)) continue;
      const selected = segments.filter(s => s.end > start && s.start < end);
      const warnings: string[] = [];
      if (duration < options.minDuration) warnings.push('short-source');
      if (selected.length) {
        const first = selected[0], last = selected[selected.length - 1];
        if (first.start < start || (start > 0 && segments.some(s => s.id !== first.id && s.end <= first.start && first.start - s.end < 1.5))) warnings.push('starts-mid-thought');
        if (last.end > end || (end < duration && !/[.!?。！？]$/.test(last.text.trim()) && segments.some(s => s.start >= last.end && s.id !== last.id && s.start - last.end < 1.5))) warnings.push('ends-too-soon');
      }
      const key = `${start.toFixed(3)}:${end.toFixed(3)}`;
      rows.set(key, { key, start, end, segmentIds: selected.map(s => s.id), source: selected.length ? 'speech' : 'scene', warnings });
    }
  }
  return [...rows.values()].sort((a, b) => a.start - b.start || a.end - b.end);
}
