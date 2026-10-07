export type TimelineViewport = { start: number; end: number };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function normalizeViewport(view: TimelineViewport, duration: number): TimelineViewport {
  if (!Number.isFinite(duration) || duration <= 0) return { start: 0, end: 0 };
  if (![view.start, view.end].every(Number.isFinite) || view.end <= view.start) return { start: 0, end: duration };
  const span = clamp(view.end - view.start, Math.min(5, duration), duration);
  const start = clamp(view.start, 0, duration - span);
  return { start, end: start + span };
}

export function zoomViewport(view: TimelineViewport, duration: number, factor: number, anchor: number): TimelineViewport {
  const current = normalizeViewport(view, duration);
  const span = current.end - current.start;
  if (!span || !Number.isFinite(factor) || factor <= 0) return current;
  const nextSpan = clamp(span * factor, Math.min(5, duration), duration);
  const focus = Number.isFinite(anchor) ? clamp(anchor, current.start, current.end) : current.start + span / 2;
  const position = (focus - current.start) / span;
  return normalizeViewport({ start: focus - nextSpan * position, end: focus + nextSpan * (1 - position) }, duration);
}

export function panViewport(view: TimelineViewport, duration: number, delta: number): TimelineViewport {
  const current = normalizeViewport(view, duration);
  const shift = Number.isFinite(delta) ? delta : 0;
  return normalizeViewport({ start: current.start + shift, end: current.end + shift }, duration);
}

export function timelineTicks(view: TimelineViewport, maxTicks = 8): number[] {
  const span = view.end - view.start;
  if (![view.start, view.end, span].every(Number.isFinite) || span <= 0) return [Number.isFinite(view.start) ? view.start : 0];
  const limit = Number.isFinite(maxTicks) ? clamp(Math.floor(maxTicks), 2, 16) : 8;
  if (limit === 2) return [view.start, view.end];
  const targetStep = span / (limit - 2);
  const preferredSteps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const magnitude = 10 ** Math.floor(Math.log10(targetStep));
  const step = preferredSteps.find(value => value >= targetStep)
    ?? [1, 2, 5, 10].map(value => value * magnitude).find(value => value >= targetStep)!;
  const ticks = [view.start];
  const first = Math.ceil(view.start / step) * step;
  // A fixed budget prevents an extreme video duration from creating an unbounded loop.
  for (let index = 0; index < limit - 2; index++) {
    const tick = first + index * step;
    if (tick >= view.end) break;
    if (tick > view.start) ticks.push(tick);
  }
  ticks.push(view.end);
  return ticks;
}

export function timeAtFraction(view: TimelineViewport, fraction: number): number {
  if (![view.start, view.end].every(Number.isFinite) || view.end < view.start) return 0;
  const position = Number.isFinite(fraction) ? clamp(fraction, 0, 1) : 0;
  return view.start + (view.end - view.start) * position;
}

export function rangeInViewport(range: TimelineViewport, view: TimelineViewport): { left: number; width: number } | null {
  const span = view.end - view.start;
  if (![range.start, range.end, view.start, view.end, span].every(Number.isFinite) || span <= 0 || range.end <= range.start) return null;
  const start = Math.max(range.start, view.start);
  const end = Math.min(range.end, view.end);
  return end > start ? { left: (start - view.start) / span, width: (end - start) / span } : null;
}
