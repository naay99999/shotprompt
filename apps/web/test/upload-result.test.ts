import { expect, test } from 'bun:test';
import { getImportedVideoId } from '../lib/upload-result';

test('reads a created video ID from path-import and file-upload responses', () => {
  const result = { video: { id: 'video-123', filename: 'interview.mp4' }, jobId: 'job-123' };
  expect(getImportedVideoId(result)).toBe('video-123');
  expect(getImportedVideoId(JSON.stringify(result))).toBe('video-123');
});

test('does not navigate on missing, malformed, or error response bodies', () => {
  for (const result of [null, undefined, '', '<html>bad gateway</html>', '{}', { id: 'job-123' }, { message: 'failed' }, { video: null }, { video: { id: 42 } }, { video: { id: '' } }, { video: { id: '  ' } }]) {
    expect(getImportedVideoId(result)).toBeNull();
  }
});

test('rejects video IDs that could change the destination route', () => {
  for (const id of ['../settings', 'a/b', 'video?tab=settings', 'video#fragment', ' video ']) {
    expect(getImportedVideoId({ video: { id } })).toBeNull();
  }
});
