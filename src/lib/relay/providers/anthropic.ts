import { env } from '../../env';
import type { ChatCompletionChunk, ChatCompletionRequest, ChatCompletionResponse, ChatMessage, Provider, UpstreamTarget } from '../types';
import { UpstreamError } from '../types';
import { isKeyInvalid, isRetriable, parseSSE, readError } from './sse';

/**
 * Translates OpenAI chat format <-> Anthropic Messages API (raw fetch; no SDK dependency on the hot path).
 */
function toAnthropic(target: UpstreamTarget, req: ChatCompletionRequest, stream: boolean) {
  const system = req.messages.filter((m) => m.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
  const messages = req.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
    .map((m) => {
      if (m.role === 'tool') {
        return { role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: String(m.content ?? '') }] };
      }
      if (m.role === 'assistant' && m.tool_calls?.length) {
        const blocks: any[] = [];
        if (m.content) blocks.push({ type: 'text', text: String(m.content) });
        for (const tc of m.tool_calls) blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: safeJson(tc.function.arguments) });
        return { role: 'assistant', content: blocks };
      }
      if (Array.isArray(m.content)) {
        // OpenAI multimodal parts -> Anthropic blocks
        const blocks = m.content.map((p: any) =>
          p.type === 'image_url'
            ? imageBlock(p.image_url.url)
            : { type: 'text', text: p.text ?? '' },
        );
        return { role: m.role, content: blocks };
      }
      return { role: m.role, content: String(m.content ?? '') };
    });

  const tools = req.tools?.map((t: any) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters ?? { type: 'object', properties: {} } }));

  return {
    model: target.upstreamModel,
    system: system || undefined,
    messages,
    max_tokens: req.max_tokens ?? 4096,
    temperature: req.temperature,
    top_p: req.top_p,
    stop_sequences: typeof req.stop === 'string' ? [req.stop] : req.stop,
    tools,
    stream,
  };
}

function imageBlock(url: string) {
  const m = /^data:(image\/\w+);base64,(.+)$/.exec(url);
  return m
    ? { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }
    : { type: 'image', source: { type: 'url', url } };
}
function safeJson(s: string) {
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}
const mapStop = (r: string | null | undefined) =>
  r === 'end_turn' || r === 'stop_sequence' ? 'stop' : r === 'max_tokens' ? 'length' : r === 'tool_use' ? 'tool_calls' : r ?? null;

async function call(target: UpstreamTarget, body: unknown, signal: AbortSignal) {
  const res = await fetch(`${target.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': target.apiKey,
      'anthropic-version': target.config.anthropicVersion ?? '2023-06-01',
      ...target.extraHeaders,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(env.UPSTREAM_TIMEOUT_MS)]),
  });
  if (!res.ok) {
    const msg = await readError(res);
    throw new UpstreamError(res.status, msg, isRetriable(res.status), isKeyInvalid(res.status, msg));
  }
  return res;
}

export const anthropicProvider: Provider = {
  async complete(target, req, signal) {
    const res = await call(target, toAnthropic(target, req, false), signal);
    const j: any = await res.json();
    const text = j.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const toolCalls = j.content
      .filter((b: any) => b.type === 'tool_use')
      .map((b: any) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) } }));
    const message: ChatMessage = { role: 'assistant', content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
    return {
      id: j.id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: req.model,
      choices: [{ index: 0, message, finish_reason: mapStop(j.stop_reason) }],
      usage: { prompt_tokens: j.usage.input_tokens, completion_tokens: j.usage.output_tokens, total_tokens: j.usage.input_tokens + j.usage.output_tokens },
    };
  },

  async *stream(target, req, signal) {
    const res = await call(target, toAnthropic(target, req, true), signal);
    if (!res.body) throw new UpstreamError(502, 'empty upstream body', true);
    let id = 'msg';
    const created = Math.floor(Date.now() / 1000);
    let inputTokens = 0, outputTokens = 0;
    const toolIndex: Record<number, number> = {}; // anthropic block index -> openai tool index
    let toolCount = 0;
    const chunk = (delta: any, finish: string | null = null): ChatCompletionChunk => ({
      id, object: 'chat.completion.chunk', created, model: req.model, choices: [{ index: 0, delta, finish_reason: finish }],
    });

    for await (const evt of parseSSE(res.body)) {
      const e = JSON.parse(evt.data);
      switch (e.type) {
        case 'message_start':
          id = e.message.id; inputTokens = e.message.usage?.input_tokens ?? 0;
          yield chunk({ role: 'assistant', content: '' });
          break;
        case 'content_block_start':
          if (e.content_block.type === 'tool_use') {
            toolIndex[e.index] = toolCount++;
            yield chunk({ tool_calls: [{ index: toolIndex[e.index], id: e.content_block.id, type: 'function', function: { name: e.content_block.name, arguments: '' } }] });
          }
          break;
        case 'content_block_delta':
          if (e.delta.type === 'text_delta') yield chunk({ content: e.delta.text });
          else if (e.delta.type === 'input_json_delta') yield chunk({ tool_calls: [{ index: toolIndex[e.index], function: { arguments: e.delta.partial_json } }] });
          break;
        case 'message_delta':
          outputTokens = e.usage?.output_tokens ?? outputTokens;
          yield chunk({}, mapStop(e.delta?.stop_reason));
          break;
        case 'message_stop': {
          const c = chunk({});
          c.choices = [];
          c.usage = { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens };
          yield c;
          return;
        }
        case 'error':
          throw new UpstreamError(502, e.error?.message ?? 'anthropic stream error', true);
      }
    }
  },
};
