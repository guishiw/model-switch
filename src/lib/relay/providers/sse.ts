import { env } from '../../env';
import { UpstreamError } from '../types';

/** Minimal SSE parser over a fetch body: yields `data:` payload strings. */
export async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event?: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let event: string | undefined;
  let data: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        if (line === '') {
          if (data.length) yield { event, data: data.join('\n') };
          event = undefined;
          data = [];
        } else if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
    }
    if (data.length) yield { event, data: data.join('\n') };
  } finally {
    reader.releaseLock();
  }
}

export async function readError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      return j?.error?.message ?? j?.message ?? text.slice(0, 500);
    } catch {
      return text.slice(0, 500);
    }
  } catch {
    return res.statusText;
  }
}

export const isRetriable = (status: number) => status === 408 || status === 409 || status === 429 || status >= 500;
export const isKeyInvalid = (status: number, msg: string) =>
  status === 401 || (status === 403 && /key|auth/i.test(msg)) || (status === 429 && /quota|billing|insufficient/i.test(msg));

import { Agent as UndiciAgent, fetch as undiciFetch } from 'undici';

const insecureAgent = new UndiciAgent({ connect: { rejectUnauthorized: false } });

/**
 * fetch that optionally skips TLS certificate verification (channel config `{"insecureTls": true}`),
 * for self-signed intranet endpoints. Uses undici directly so the setting stays per-channel
 * instead of process-wide (NODE_TLS_REJECT_UNAUTHORIZED).
 */
export function upstreamFetch(url: string, init: RequestInit & { signal: AbortSignal }, insecureTls?: boolean): Promise<Response> {
  if (!insecureTls) return fetch(url, init);
  return undiciFetch(url, { ...(init as any), dispatcher: insecureAgent }) as unknown as Promise<Response>;
}

export type UpstreamCall = {
  res: Response;
  /** Stop the total-duration timer. Call when the response has been fully consumed (or abandoned). */
  finish: () => void;
};

/**
 * Perform an upstream HTTP call with two independent timeouts:
 *   - TTFB:  headers + first body chunk must arrive within UPSTREAM_TTFB_TIMEOUT_MS
 *   - total: the whole call (incl. streaming the body) must finish within UPSTREAM_TOTAL_TIMEOUT_MS
 * Timeouts and network errors surface as retriable UpstreamError(504 / 502) so the engine can
 * fail over to another channel. Client aborts propagate unchanged (not retriable).
 */
export async function upstreamRequest(url: string, init: Omit<RequestInit, 'signal'>, clientSignal: AbortSignal, insecureTls?: boolean): Promise<UpstreamCall> {
  const ctrl = new AbortController();
  const ttfbMs = env.UPSTREAM_TTFB_TIMEOUT_MS, totalMs = env.UPSTREAM_TOTAL_TIMEOUT_MS;
  const abortWith = (status: number, msg: string) => () => ctrl.abort(new UpstreamError(status, msg, true));
  let ttfbTimer: NodeJS.Timeout | undefined = setTimeout(abortWith(504, `Upstream did not send a first byte within ${ttfbMs / 1000}s`), ttfbMs);
  const totalTimer = setTimeout(abortWith(504, `Upstream call exceeded ${totalMs / 1000}s total`), totalMs);
  const onClientAbort = () => ctrl.abort(clientSignal.reason ?? new DOMException('client aborted', 'AbortError'));
  if (clientSignal.aborted) onClientAbort(); else clientSignal.addEventListener('abort', onClientAbort, { once: true });

  const clearTtfb = () => { if (ttfbTimer) { clearTimeout(ttfbTimer); ttfbTimer = undefined; } };
  const finish = () => { clearTtfb(); clearTimeout(totalTimer); clientSignal.removeEventListener('abort', onClientAbort); };

  try {
    const res = await upstreamFetch(url, { ...init, signal: ctrl.signal }, insecureTls);
    if (!res.body) { clearTtfb(); return { res, finish }; }
    // First chunk (not just headers) counts as the first byte.
    const body = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, c) { clearTtfb(); c.enqueue(chunk); },
    }));
    return { res: new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers }), finish };
  } catch (err) {
    finish();
    throw normalizeFetchError(err, ctrl.signal, clientSignal);
  }
}

/** Map fetch/undici failures to UpstreamError; leave client aborts alone. */
export function normalizeFetchError(err: unknown, signal: AbortSignal, clientSignal: AbortSignal): unknown {
  if (err instanceof UpstreamError) return err;
  if (signal.aborted && signal.reason instanceof UpstreamError) return signal.reason;
  if (clientSignal.aborted) return err;
  const e = err as any;
  if (e?.name === 'TimeoutError') return new UpstreamError(504, 'Upstream request timed out', true);
  if (e?.name === 'TypeError' || e?.code) {
    const cause = e.cause ?? e;
    return new UpstreamError(502, `Upstream connection failed: ${cause?.code ?? cause?.message ?? e.message}`, true);
  }
  return err;
}

/**
 * Wrap an async body-consuming function so mid-stream timeouts (which surface as abort
 * rejections from the reader) become UpstreamError(504), and the total timer is always cleared.
 */
export async function withUpstreamBody<T>(call: UpstreamCall, clientSignal: AbortSignal, fn: (res: Response) => Promise<T>): Promise<T> {
  try {
    return await fn(call.res);
  } catch (err) {
    throw normalizeBodyError(err, clientSignal);
  } finally {
    call.finish();
  }
}

export function normalizeBodyError(err: unknown, clientSignal: AbortSignal): unknown {
  if (err instanceof UpstreamError) return err;
  if (clientSignal.aborted) return err;
  const e = err as any;
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return new UpstreamError(504, 'Upstream stream timed out', true);
  if (e?.code === 'ECONNRESET' || e?.code === 'UND_ERR_SOCKET' || /terminated|socket/i.test(String(e?.message))) return new UpstreamError(502, `Upstream stream ended unexpectedly: ${e.code ?? e.message}`, true);
  return err;
}
