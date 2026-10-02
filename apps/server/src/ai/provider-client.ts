import { AiAnalysisError, type ProviderConfig } from '@shotprompt/core';
export interface ModelRequest { messages: { role: 'system' | 'user' | 'assistant'; content: string }[]; schema: Record<string, unknown>; maxOutputTokens: number }
export interface ModelResponse { value: unknown; reportedModel: string | null; usage: { inputTokens: number | null; outputTokens: number | null } }
export interface ProviderClient { complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> }
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const validCount = (value: unknown): number | null => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
async function boundedText(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.body) throw new AiAnalysisError('invalid-output');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true }); let bytes = 0, text = '';
  const aborted = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', aborted, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted(); const part = await reader.read(); signal.throwIfAborted();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 1048576) { await reader.cancel(); throw new AiAnalysisError('invalid-output'); }
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { signal.removeEventListener('abort', aborted); reader.releaseLock(); }
}
export function createProviderClient(config: ProviderConfig, dependencies: { fetch?: FetchLike; apiKey?: () => string | undefined } = {}): ProviderClient {
  return { async complete(request, parentSignal) {
    parentSignal.throwIfAborted();
    const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(new AiAnalysisError('provider-timeout')), config.requestTimeoutSeconds * 1000);
    const signal = AbortSignal.any([parentSignal, deadline.signal]);
    const apiKey = dependencies.apiKey ? dependencies.apiKey() : process.env.SHOTPROMPT_LLM_API_KEY;
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) };
    const body = config.protocol === 'ollama'
      ? { model: config.model, messages: request.messages, stream: false, format: config.outputMode === 'schema' ? request.schema : 'json', options: { temperature: 0, num_predict: request.maxOutputTokens } }
      : { model: config.model, messages: request.messages, stream: false, temperature: 0, max_tokens: request.maxOutputTokens, response_format: config.outputMode === 'schema' ? { type: 'json_schema', json_schema: { name: 'highlight_response', strict: true, schema: request.schema } } : { type: 'json_object' }, ...(config.presetId === 'openrouter' && config.outputMode === 'schema' ? { provider: { require_parameters: true } } : {}) };
    try {
      const endpoint = `${config.baseUrl.replace(/\/$/, '')}${config.protocol === 'ollama' ? '/api/chat' : '/chat/completions'}`;
      const response = await (dependencies.fetch ?? fetch)(endpoint, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal });
      if (!response.ok) {
        const code = response.status === 401 || response.status === 403 ? 'provider-credentials' : response.status === 402 ? 'provider-credits' : response.status === 429 ? 'provider-rate-limit' : response.status === 404 ? 'model-unavailable' : 'provider-unavailable';
        let detail = ''; try { detail = await boundedText(response, signal); } catch { signal.throwIfAborted(); }
        if (response.status === 400 && /context|token.{0,30}(limit|length)|too.{0,10}long/i.test(detail)) throw new AiAnalysisError('context-too-large');
        if (response.status === 400 && /response_format|json_schema|structured|format.{0,30}support/i.test(detail)) throw new AiAnalysisError('unsupported-output-mode');
        throw new AiAnalysisError(code);
      }
      let envelope: any; try { envelope = JSON.parse(await boundedText(response, signal)); } catch (error) { signal.throwIfAborted(); if (error instanceof AiAnalysisError) throw error; throw new AiAnalysisError('invalid-output'); }
      const content = config.protocol === 'ollama' ? envelope?.done === true ? envelope.message?.content : null : envelope?.choices?.[0]?.finish_reason === 'stop' ? envelope.choices[0].message?.content : null;
      if (typeof content !== 'string') throw new AiAnalysisError('invalid-output');
      let value: unknown; try { value = JSON.parse(content); } catch { throw new AiAnalysisError('invalid-output'); }
      return { value, reportedModel: typeof envelope.model === 'string' && envelope.model.length <= 200 && (!apiKey || !envelope.model.includes(apiKey)) ? envelope.model : null,
        usage: { inputTokens: validCount(config.protocol === 'ollama' ? envelope.prompt_eval_count : envelope.usage?.prompt_tokens), outputTokens: validCount(config.protocol === 'ollama' ? envelope.eval_count : envelope.usage?.completion_tokens) } };
    } catch (error) {
      if (parentSignal.aborted) throw parentSignal.reason;
      if (deadline.signal.aborted) throw new AiAnalysisError('provider-timeout');
      if (error instanceof AiAnalysisError) throw error;
      throw new AiAnalysisError('provider-unavailable');
    } finally { clearTimeout(timer); }
  } };
}
export async function checkProvider(_config: ProviderConfig, client: ProviderClient, signal: AbortSignal): Promise<{ status: 'ready' }> {
  const result = await client.complete({ messages: [{ role: 'system', content: 'Return exactly a JSON object with ok true. This is a synthetic connection check.' }, { role: 'user', content: '{"ok":true}' }], schema: { type: 'object', properties: { ok: { type: 'boolean', const: true } }, required: ['ok'], additionalProperties: false }, maxOutputTokens: 64 }, signal);
  if (!result.value || typeof result.value !== 'object' || Array.isArray(result.value) || (result.value as { ok?: unknown }).ok !== true || Object.keys(result.value).length !== 1) throw new AiAnalysisError('invalid-output');
  return { status: 'ready' };
}
