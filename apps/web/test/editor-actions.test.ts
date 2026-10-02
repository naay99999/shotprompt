import { expect, test } from 'bun:test';
import { createSaveQueue, rangeError, mergeSubtitleEdits, subtitleRangeError } from '../lib/editor-actions';

test('serializes writes so an older request cannot overwrite a newer edit', async () => {
  const enqueue = createSaveQueue();
  const events: number[] = [];
  let release!: () => void;
  const first = enqueue(async () => { await new Promise<void>(resolve => { release = resolve; }); events.push(1); });
  const second = enqueue(async () => { events.push(2); });
  await Promise.resolve();
  expect(events).toEqual([]);
  release(); await Promise.all([first, second]);
  expect(events).toEqual([1, 2]);
});

test('a failed save does not prevent a later retry', async () => {
  const enqueue = createSaveQueue();
  await expect(enqueue(async () => { throw new Error('offline'); })).rejects.toThrow('offline');
  expect(await enqueue(async () => 'saved')).toBe('saved');
});

test('rejects reversed, too short, nonfinite and out-of-video manual ranges', () => {
  for (const [start, end] of [[4, 3], [0, 1], [-1, 5], [0, 61], [NaN, 10], [0, Infinity]]) {
    expect(rangeError(start, end, 60)).not.toBeNull();
  }
  expect(rangeError(0, 2, 60)).toBeNull();
  expect(rangeError(10, 60, 60)).toBeNull();
});

test('preserves locally edited subtitles and newly included rows after extending a clip', () => {
  const existing = { id: 1, start: 2, end: 4, text: 'original' };
  const added = { id: 2, start: 5, end: 7, text: 'new range' };
  const edited = { ...existing, text: 'corrected', start: 2.5 };
  expect(mergeSubtitleEdits([existing, added], [edited])).toEqual([edited, added]);
  expect(subtitleRangeError([edited, added], 10)).toBeNull();
  expect(subtitleRangeError([{ ...edited, end: NaN }], 10)).not.toBeNull();
  expect(subtitleRangeError([{ ...edited, end: 11 }], 10)).not.toBeNull();
});

test('recovers edits after a committed subtitle save loses its response', () => {
  const sent = [{ id: 1, start: 0, end: 2, text: 'first correction' }];
  const server = [{ ...sent[0], id: 8 }];
  const draft = [{ ...sent[0], text: 'second correction' }];
  expect(mergeSubtitleEdits(server, draft, sent)).toEqual([{ ...server[0], text: 'second correction' }]);
  expect(() => mergeSubtitleEdits(server, draft)).toThrow('identities changed');
  expect(() => mergeSubtitleEdits([{ ...server[0], text: 'another writer' }], draft, sent)).toThrow('identities changed');
});
