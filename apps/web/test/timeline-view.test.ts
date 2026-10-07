import { expect, test } from 'bun:test';
import { normalizeViewport, zoomViewport, panViewport, timelineTicks, timeAtFraction, rangeInViewport } from '../lib/timeline-view';

test('empty and nonfinite durations have a safe empty viewport', () => {
  for (const duration of [0, -1, NaN, Infinity]) {
    expect(normalizeViewport({ start: 20, end: 40 }, duration)).toEqual({ start: 0, end: 0 });
    expect(zoomViewport({ start: 20, end: 40 }, duration, 0.5, 30)).toEqual({ start: 0, end: 0 });
    expect(timeAtFraction({ start: 0, end: 0 }, 0.5)).toBe(0);
  }
});

test('invalid viewport values recover to the full video and shifted views stay bounded', () => {
  expect(normalizeViewport({ start: NaN, end: Infinity }, 100)).toEqual({ start: 0, end: 100 });
  expect(normalizeViewport({ start: -10, end: 10 }, 100)).toEqual({ start: 0, end: 20 });
  expect(normalizeViewport({ start: 90, end: 110 }, 100)).toEqual({ start: 80, end: 100 });
  expect(normalizeViewport({ start: 40, end: 20 }, 100)).toEqual({ start: 0, end: 100 });
});

test('zooming near either video boundary preserves its anchor and stays inside the video', () => {
  expect(zoomViewport({ start: 0, end: 100 }, 100, 0.5, 0)).toEqual({ start: 0, end: 50 });
  expect(zoomViewport({ start: 0, end: 100 }, 100, 0.5, 100)).toEqual({ start: 50, end: 100 });
  expect(zoomViewport({ start: 0, end: 20 }, 100, 2, 1)).toEqual({ start: 0, end: 40 });
  expect(zoomViewport({ start: 80, end: 100 }, 100, 2, 99)).toEqual({ start: 60, end: 100 });
});

test('a ninety-minute video can zoom to a seconds-wide view without losing precision', () => {
  let view = { start: 0, end: 5400 };
  for (let i = 0; i < 20; i++) view = zoomViewport(view, 5400, 0.5, 5234.25);
  expect(view.end - view.start).toBe(5);
  expect(view.start).toBeLessThan(5234.25);
  expect(view.end).toBeGreaterThan(5234.25);
  expect(timeAtFraction({ start: 5230, end: 5235 }, 0.85)).toBeCloseTo(5234.25, 8);
});

test('pan clamps both boundaries and ignores nonfinite movement', () => {
  expect(panViewport({ start: 20, end: 40 }, 100, -30)).toEqual({ start: 0, end: 20 });
  expect(panViewport({ start: 20, end: 40 }, 100, 100)).toEqual({ start: 80, end: 100 });
  expect(panViewport({ start: 20, end: 40 }, 100, Infinity)).toEqual({ start: 20, end: 40 });
  expect(zoomViewport({ start: 20, end: 40 }, 100, NaN, Infinity)).toEqual({ start: 20, end: 40 });
});

test('short videos remain usable when smaller than the minimum zoom span', () => {
  expect(normalizeViewport({ start: 0, end: 1 }, 2)).toEqual({ start: 0, end: 2 });
  expect(zoomViewport({ start: 0, end: 2 }, 2, 0.5, 1)).toEqual({ start: 0, end: 2 });
});

test('ruler ticks include viewport bounds and remain sparse for long videos', () => {
  for (const view of [{ start: 0, end: 5400 }, { start: 5234.25, end: 5239.25 }, { start: 0, end: 1e12 }]) {
    const ticks = timelineTicks(view, 8);
    expect(ticks[0]).toBe(view.start);
    expect(ticks.at(-1)).toBe(view.end);
    expect(ticks.length).toBeLessThanOrEqual(8);
    expect(ticks.every((tick, index) => Number.isFinite(tick) && tick >= view.start && tick <= view.end && (!index || tick > ticks[index - 1]))).toBe(true);
  }
  expect(timelineTicks({ start: 0, end: 0 })).toEqual([0]);
  expect(timelineTicks({ start: NaN, end: Infinity })).toEqual([0]);
  expect(timelineTicks({ start: 0, end: 5400 }, Infinity).length).toBeLessThanOrEqual(8);
});

test('drag coordinates clamp to the visible viewport and recover from nonfinite positions', () => {
  expect(timeAtFraction({ start: 100, end: 120 }, -0.1)).toBe(100);
  expect(timeAtFraction({ start: 100, end: 120 }, 1.1)).toBe(120);
  expect(timeAtFraction({ start: 100, end: 120 }, 0.25)).toBe(105);
  expect(timeAtFraction({ start: 100, end: 120 }, NaN)).toBe(100);
});

test('candidate and selected ranges clip to the visible viewport without invalid widths', () => {
  const view = { start: 100, end: 120 };
  expect(rangeInViewport({ start: 90, end: 110 }, view)).toEqual({ left: 0, width: 0.5 });
  expect(rangeInViewport({ start: 110, end: 130 }, view)).toEqual({ left: 0.5, width: 0.5 });
  expect(rangeInViewport({ start: 90, end: 130 }, view)).toEqual({ left: 0, width: 1 });
  for (const range of [{ start: 0, end: 99 }, { start: 120, end: 125 }, { start: 110, end: 100 }, { start: NaN, end: 110 }]) {
    expect(rangeInViewport(range, view)).toBeNull();
  }
  expect(rangeInViewport({ start: 0, end: 2 }, { start: 0, end: 0 })).toBeNull();
});
