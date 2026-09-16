import type { ChatMessage } from './types';

let enc: { encode: (s: string) => Uint32Array } | null = null;
function encoder() {
  if (enc) return enc;
  try {
    // cl100k_base is a good enough approximation across vendors
    const { get_encoding } = require('tiktoken');
    enc = get_encoding('cl100k_base');
  } catch {
    enc = { encode: (s: string) => new Uint32Array(Math.ceil(s.length / 4)) };
  }
  return enc!;
}

export function countText(text: string): number {
  return encoder().encode(text).length;
}

/** Rough OpenAI-style message token estimate (used for TPM pre-checks and fallback usage) */
export function countMessages(messages: ChatMessage[]): number {
  let n = 3;
  for (const m of messages) {
    n += 4;
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
    n += countText(content) + countText(m.role);
    if (m.tool_calls) n += countText(JSON.stringify(m.tool_calls));
  }
  return n;
}
