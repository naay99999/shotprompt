import { expect, it } from 'bun:test';
import type { ProviderConfig } from '@shotprompt/core';
import { createProviderClient } from '../src/ai/provider-client';

const config = (outputMode: 'schema' | 'json'): ProviderConfig => ({ presetId: 'openrouter', protocol: 'openai-compatible', inferenceLocation: 'external', baseUrl: 'https://openrouter.ai/api/v1', model: 'provider/model', outputMode, externalEnabled: true, requestTimeoutSeconds: 10, runTimeoutSeconds: 60 });
const request = { messages: [{ role: 'user' as const, content: 'test' }], schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false }, maxOutputTokens: 128 };

it('requires OpenRouter endpoints that support the JSON schema when schema output is selected', async () => {
  let body: any, authorization = '';
  const client = createProviderClient(config('schema'), { apiKey: () => 'private-key', fetch: async (_input, init) => { body = JSON.parse(String(init?.body)); authorization = new Headers(init?.headers).get('authorization') ?? ''; return Response.json({ model: 'provider/model', choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] }); } });
  await client.complete(request, new AbortController().signal);
  expect(body.provider).toEqual({ require_parameters: true }); expect(authorization).toBe('Bearer private-key');
  expect(JSON.stringify(body)).not.toContain('private-key');
});

it('does not add OpenRouter schema routing constraints for JSON mode and sanitizes credit errors', async () => {
  let body: any;
  const jsonClient = createProviderClient(config('json'), { fetch: async (_input, init) => { body = JSON.parse(String(init?.body)); return Response.json({ model: 'provider/model', choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] }); } });
  await jsonClient.complete(request, new AbortController().signal); expect(body.provider).toBeUndefined();
  const credits = createProviderClient(config('schema'), { fetch: async () => new Response('private-key provider detail', { status: 402 }) });
  await expect(credits.complete(request, new AbortController().signal)).rejects.toThrow('provider-credits');
});
