import { env } from '../../env';
import type { ChatCompletionChunk, ChatCompletionRequest, ChatCompletionResponse, Provider, UpstreamTarget } from '../types';
import { UpstreamError } from '../types';
import { isKeyInvalid, isRetriable, parseSSE, readError, upstreamFetch } from './sse';

/**
 * OpenAI + any OpenAI-compatible endpoint (Qwen compatible-mode, DeepSeek, Moonshot, vLLM, Ollama /v1 ...).
 * Pass-through with model substitution.
 */
function buildBody(target: UpstreamTarget, req: ChatCompletionRequest, stream: boolean) {
  const { session_id, ...rest } = req;
  return { ...rest, model: target.upstreamModel, stream, ...(stream ? { stream_options: { include_usage: true } } : {}) };
}

async function call(target: UpstreamTarget, body: unknown, signal: AbortSignal) {
  const res = await upstreamFetch(`${target.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${target.apiKey}`, ...target.extraHeaders },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(env.UPSTREAM_TIMEOUT_MS)]),
  }, target.config.insecureTls === true);
  if (!res.ok) {
    const msg = await readError(res);
    throw new UpstreamError(res.status, msg, isRetriable(res.status), isKeyInvalid(res.status, msg));
  }
  return res;
}

export const openaiProvider: Provider = {
  async complete(target, req, signal) {
    const res = await call(target, buildBody(target, req, false), signal);
    const json = (await res.json()) as ChatCompletionResponse;
    // Ollama / some vendors omit stream_options; ensure usage exists
    json.usage ??= { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    return json;
  },

  async *stream(target, req, signal) {
    const res = await call(target, buildBody(target, req, true), signal);
    if (!res.body) throw new UpstreamError(502, 'empty upstream body', true);
    for await (const evt of parseSSE(res.body)) {
      if (evt.data === '[DONE]') return;
      try {
        yield JSON.parse(evt.data) as ChatCompletionChunk;
      } catch {
        /* ignore keepalive / malformed lines */
      }
    }
  },
};
