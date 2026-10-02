import { expect, test } from 'bun:test';
import { describeError, checkResponse } from '../lib/ui-error';

test('keeps unknown diagnostics out of the primary message', () => {
  const raw = 'ffmpeg exited 1: private/input.mp4 decoder failure';
  const result = describeError(raw);
  expect(result.message).not.toContain('ffmpeg');
  expect(result.message).not.toContain('private/');
  expect(result.details).toBe(raw);
});

test('maps unavailable models to a download action', () => {
  expect(describeError({ status: 400, value: { message: 'model not downloaded' } }).message).toContain('ดาวน์โหลด');
});

test('distinguishes connection failures from missing data', () => {
  expect(describeError(new TypeError('Failed to fetch')).message).toContain('เชื่อมต่อ');
  expect(describeError({ status: 404, value: { message: 'not found' } }).message).toContain('ไม่พบ');
});

test('rejects unsuccessful API responses rather than reporting success', () => {
  const error = { status: 409, value: { message: 'job active' } };
  expect(() => checkResponse({ data: null, error })).toThrow();
  const response = { data: { ok: true }, error: null };
  expect(checkResponse(response)).toBe(response);
});

test('explains profile setup, vault, in-use and provider credit errors in Thai', () => {
  expect(describeError({ value: { error: 'provider-credits' } }).message).toContain('เครดิต');
  expect(describeError({ value: { error: 'credential-vault-unavailable' } }).message).toContain('vault');
  expect(describeError({ value: { error: 'profile-in-use' } }).message).toContain('กำลังใช้โปรไฟล์นี้');
  expect(describeError({ value: { error: 'profile-not-ready' } }).message).toContain('ทดสอบ');
});
