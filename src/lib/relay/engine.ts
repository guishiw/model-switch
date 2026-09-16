import { env } from '../env';
import { logger } from '../logger';
import { recordFailure, recordSuccess } from '../circuit-breaker';
import { disableKey, selectUpstream, type Selection } from './selector';
import { providerFor } from './providers';
import { countMessages, countText } from './tokens';
import { Errors, RelayError } from '../errors';
import type { ChatCompletionChunk, ChatCompletionRequest, ChatCompletionResponse, Usage } from './types';
import { UpstreamError } from './types';

export type RelayMeta = {
  requestId: string;
  selection: Selection;
  retries: number;
  ttfbMs?: number;
  usage: Usage;
  /** Assembled assistant text (stream) or message content */
  outputText: string;
  finishReason: string | null;
};

type Attempt = { selection: Selection; req: ChatCompletionRequest };

/** Merge param template under the request (request wins), drop gateway-only fields */
function applyTemplate(req: ChatCompletionRequest, defaults: Record<string, unknown>): ChatCompletionRequest {
  const merged: Record<string, unknown> = { ...defaults };
  for (const [k, v] of Object.entries(req)) if (v !== undefined) merged[k] = v;
  return merged as ChatCompletionRequest;
}

/**
 * Iterate candidate channels with retry-on-failure. `fn` performs the actual call;
 * if it throws a retriable UpstreamError before any bytes were sent to the client,
 * we move to the next channel.
 */
async function withFailover<T>(
  req: ChatCompletionRequest,
  estimatedTokens: number,
  fn: (a: Attempt, attempt: number) => Promise<T>,
): Promise<{ result: T; selection: Selection; retries: number }> {
  const exclude = new Set<string>();
  let lastErr: unknown;
  for (let attempt = 0; attempt <= env.RELAY_MAX_RETRIES; attempt++) {
    const selection = await selectUpstream(req.model, estimatedTokens, exclude);
    if (!selection) {
      if (attempt === 0) throw Errors.noChannel(req.model);
      break;
    }
    const upstreamReq = applyTemplate(req, selection.defaultParams);
    try {
      const result = await fn({ selection, req: upstreamReq }, attempt);
      await recordSuccess(selection.target.channelId);
      return { result, selection, retries: attempt };
    } catch (err) {
      lastErr = err;
      if (err instanceof UpstreamError) {
        logger.warn({ channel: selection.target.channelName, status: err.status, msg: err.message, attempt }, 'upstream error');
        if (err.keyInvalid) await disableKey(selection.target.apiKeyId, `${err.status}: ${err.message.slice(0, 120)}`);
        await recordFailure(selection.target.channelId);
        if (!err.retriable && !err.keyInvalid) throw Errors.upstream(err.status, err.message);
        exclude.add(selection.target.channelId);
        continue;
      }
      throw err; // aborted / already-streaming / unexpected
    }
  }
  if (lastErr instanceof UpstreamError) throw Errors.upstream(lastErr.status, lastErr.message);
  throw new RelayError(502, 'All upstream channels failed', 'upstream_error', 'all_channels_failed');
}

// ---------------------------------------------------------------------------

export async function relayComplete(requestId: string, req: ChatCompletionRequest, signal: AbortSignal): Promise<{ response: ChatCompletionResponse; meta: RelayMeta }> {
  const estimated = countMessages(req.messages) + (req.max_tokens ?? 1024);
  const started = Date.now();
  const { result, selection, retries } = await withFailover(req, estimated, async ({ selection, req }) => {
    const provider = providerFor(selection.target.provider);
    return provider.complete(selection.target, req, signal);
  });
  result.model = req.model; // present the public model name to the client
  const text = result.choices.map((c) => (typeof c.message.content === 'string' ? c.message.content : '')).join('');
  if (!result.usage.total_tokens) {
    result.usage = { prompt_tokens: countMessages(req.messages), completion_tokens: countText(text), total_tokens: 0 };
    result.usage.total_tokens = result.usage.prompt_tokens + result.usage.completion_tokens;
  }
  return {
    response: result,
    meta: { requestId, selection, retries, ttfbMs: Date.now() - started, usage: result.usage, outputText: text, finishReason: result.choices[0]?.finish_reason ?? null },
  };
}

/**
 * Streaming relay. Failover only happens before the first chunk has been yielded.
 * The generator returns RelayMeta when the stream completes.
 */
export async function* relayStream(requestId: string, req: ChatCompletionRequest, signal: AbortSignal): AsyncGenerator<ChatCompletionChunk, RelayMeta> {
  const estimated = countMessages(req.messages) + (req.max_tokens ?? 1024);
  const started = Date.now();
  const exclude = new Set<string>();
  let lastErr: unknown;

  for (let attempt = 0; attempt <= env.RELAY_MAX_RETRIES; attempt++) {
    const selection = await selectUpstream(req.model, estimated, exclude);
    if (!selection) {
      if (attempt === 0) throw Errors.noChannel(req.model);
      break;
    }
    const upstreamReq = applyTemplate(req, selection.defaultParams);
    const provider = providerFor(selection.target.provider);
    const gen = provider.stream(selection.target, upstreamReq, signal);

    let ttfbMs: number | undefined;
    let outputText = '';
    let usage: Usage | undefined;
    let finishReason: string | null = null;
    let yielded = false;

    try {
      for await (const chunk of gen) {
        if (ttfbMs === undefined) ttfbMs = Date.now() - started;
        chunk.model = req.model;
        for (const c of chunk.choices ?? []) {
          if (typeof c.delta?.content === 'string') outputText += c.delta.content;
          if (c.finish_reason) finishReason = c.finish_reason;
        }
        if (chunk.usage) usage = chunk.usage;
        yielded = true;
        yield chunk;
      }
      await recordSuccess(selection.target.channelId);
      if (!usage || !usage.total_tokens) {
        const p = countMessages(req.messages), c = countText(outputText);
        usage = { prompt_tokens: p, completion_tokens: c, total_tokens: p + c };
      }
      return { requestId, selection, retries: attempt, ttfbMs, usage, outputText, finishReason };
    } catch (err) {
      lastErr = err;
      if (err instanceof UpstreamError && !yielded) {
        logger.warn({ channel: selection.target.channelName, status: err.status, msg: err.message, attempt }, 'upstream stream error');
        if (err.keyInvalid) await disableKey(selection.target.apiKeyId, `${err.status}: ${err.message.slice(0, 120)}`);
        await recordFailure(selection.target.channelId);
        if (!err.retriable && !err.keyInvalid) throw Errors.upstream(err.status, err.message);
        exclude.add(selection.target.channelId);
        continue;
      }
      if (err instanceof UpstreamError) await recordFailure(selection.target.channelId);
      throw err;
    }
  }
  if (lastErr instanceof UpstreamError) throw Errors.upstream(lastErr.status, lastErr.message);
  throw new RelayError(502, 'All upstream channels failed', 'upstream_error', 'all_channels_failed');
}

export function computeCost(usage: Usage, pricing: Selection['pricing']) {
  return (usage.prompt_tokens * pricing.input + usage.completion_tokens * pricing.output) / 1_000_000;
}
