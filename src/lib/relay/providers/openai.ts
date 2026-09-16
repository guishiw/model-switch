import type { ChatCompletionChunk, ChatCompletionRequest, ChatCompletionResponse, Provider, UpstreamTarget } from '../types';
import { UpstreamError } from '../types';
import { isKeyInvalid, isRetriable, normalizeBodyError, parseSSE, readError, upstreamRequest, withUpstreamBody } from './sse';

/**
 * OpenAI + any OpenAI-compatible endpoint (Qwen compatible-mode, DeepSeek, Moonshot, vLLM, Ollama /v1 ...).
 * Pass-through with model substitution.
 */
function buildBody(target: UpstreamTarget, req: ChatCompletionRequest, stream: boolean) {
  const { session_id, ...rest } = req;
  return { ...rest, model: target.upstreamModel, stream, ...(stream ? { stream_options: { include_usage: true } } : {}) };
}

async function call(target: UpstreamTarget, body: unknown, signal: AbortSignal) {
  const c = await upstreamRequest(`${target.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${target.apiKey}`, ...target.extraHeaders },
    body: JSON.stringify(body),
  }, signal, target.config.insecureTls === true);
  if (!c.res.ok) {
    const msg = await readError(c.res).finally(c.finish);
    throw new UpstreamError(c.res.status, msg, isRetriable(c.res.status), isKeyInvalid(c.res.status, msg));
  }
  return c;
}

export const openaiProvider: Provider = {
  async complete(target, req, signal) {
    const c = await call(target, buildBody(target, req, false), signal);
    const json = await withUpstreamBody(c, signal, (res) => res.json() as Promise<ChatCompletionResponse>);
    // Ollama / some vendors omit stream_options; ensure usage exists
    json.usage ??= { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    return json;
  },

  async *stream(target, req, signal) {
    const c = await call(target, buildBody(target, req, true), signal);
    if (!c.res.body) { c.finish(); throw new UpstreamError(502, 'empty upstream body', true); }
    try {
      for await (const evt of parseSSE(c.res.body)) {
        if (evt.data === '[DONE]') return;
        try {
          yield JSON.parse(evt.data) as ChatCompletionChunk;
        } catch {
          /* ignore keepalive / malformed lines */
        }
      }
    } catch (err) {
      throw normalizeBodyError(err, signal);
    } finally {
      c.finish();
    }
  },
};
