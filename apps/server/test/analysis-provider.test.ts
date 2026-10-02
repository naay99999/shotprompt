import { expect, it } from 'bun:test';
import { createProviderClient, checkProvider } from '../src/ai/provider-client';
import { parseProviderConfig } from '../src/ai/provider-settings';
const request = { messages: [{ role: 'user' as const, content: 'synthetic check' }], schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false }, maxOutputTokens: 4096 };
it('calls real native and compatible HTTP servers with structured output and server-only credentials', async () => {
  for (const protocol of ['ollama', 'openai-compatible'] as const) for (const outputMode of ['schema', 'json'] as const) {
    let observed: any;
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
      observed = { path: new URL(req.url).pathname, body: await req.json(), auth: req.headers.get('authorization') };
      return Response.json(protocol === 'ollama' ? { model: 'test', done: true, message: { role: 'assistant', content: '{"ok":true}' }, prompt_eval_count: 10, eval_count: 3 } : { model: 'test', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}' } }], usage: { prompt_tokens: 10, completion_tokens: 3 } });
    } });
    try {
      const config = parseProviderConfig({ protocol, outputMode, model: 'test', baseUrl: `http://127.0.0.1:${server.port}${protocol === 'ollama' ? '' : '/v1'}` });
      const client = createProviderClient(config, { apiKey: () => 'fixture-secret' });
      const result = await client.complete(request, new AbortController().signal);
      expect(result.value).toEqual({ ok: true }); expect(result.usage.inputTokens).toBe(10);
      expect(observed.auth).toBe('Bearer fixture-secret'); expect(observed.body.stream).toBe(false);
      expect(observed.path).toBe(protocol === 'ollama' ? '/api/chat' : '/v1/chat/completions');
      expect(protocol === 'ollama' ? observed.body.format : observed.body.response_format.type).toEqual(protocol === 'ollama' ? outputMode === 'schema' ? request.schema : 'json' : outputMode === 'schema' ? 'json_schema' : 'json_object');
      expect(JSON.stringify(result)).not.toContain('fixture-secret');
      expect((await checkProvider(config, client, new AbortController().signal)).status).toBe('ready');
    } finally { server.stop(true); }
  }
});
it('rejects redirects, malformed completed bodies and oversized responses without leaking errors', async () => {
  for (const kind of ['redirect', 'auth', 'malformed', 'oversized', 'truncated']) {
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
      if (kind === 'redirect') return new Response('', { status: 302, headers: { location: 'http://127.0.0.1:1/secret' } });
      if (kind === 'auth') return new Response('fixture-secret', { status: 401 });
      if (kind === 'oversized') return new Response('x'.repeat(1048577));
      if (kind === 'truncated') return Response.json({ choices: [{ finish_reason: 'length', message: { content: '{"ok":true}' } }] });
      return Response.json({ choices: [] });
    } });
    try {
      const client = createProviderClient(parseProviderConfig({ protocol: 'openai-compatible', baseUrl: `http://127.0.0.1:${server.port}`, model: 'test' }), { apiKey: () => 'fixture-secret' });
      let error: any; try { await client.complete(request, new AbortController().signal); } catch (e) { error = e; }
      expect(error).toBeDefined(); expect(error.message).not.toContain('fixture-secret');
    } finally { server.stop(true); }
  }
});
it('cancels while reading a response body instead of waiting for completion', async () => {
  const controller = new AbortController();
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{')); setTimeout(() => controller.abort(), 20); } })); } });
  try {
    const client = createProviderClient(parseProviderConfig({ baseUrl: `http://127.0.0.1:${server.port}`, model: 'test' }));
    await expect(client.complete(request, controller.signal)).rejects.toThrow();
  } finally { server.stop(true); }
});
