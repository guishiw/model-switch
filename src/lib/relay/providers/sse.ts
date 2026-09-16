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
