import { expect, test } from 'bun:test';
import { exportSelectionForWorkspace } from '../lib/workspace-state';

test('exports the active clip when no batch selection exists', () => {
  expect(exportSelectionForWorkspace([{ id: 'a' }, { id: 'b' }], {}, 'b')).toEqual({ b: true });
});

test('preserves a batch selection instead of silently adding the active clip', () => {
  expect(exportSelectionForWorkspace([{ id: 'a' }, { id: 'b' }], { a: true }, 'b')).toEqual({ a: true });
});

test('ignores deleted selections and never exports a missing active clip', () => {
  expect(exportSelectionForWorkspace([{ id: 'a' }], { removed: true }, 'a')).toEqual({ a: true });
  expect(exportSelectionForWorkspace([{ id: 'a' }], {}, 'removed')).toEqual({});
  expect(exportSelectionForWorkspace([], {}, null)).toEqual({});
});
