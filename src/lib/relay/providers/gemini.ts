import type { ChatCompletionChunk, ChatCompletionRequest, ChatCompletionResponse, Provider, UpstreamTarget } from '../types';
import { UpstreamError } from '../types';
import { isKeyInvalid, isRetriable, normalizeBodyError, parseSSE, readError, upstreamRequest, withUpstreamBody } from './sse';

/** OpenAI chat -> Gemini generateContent (text + basic function calling) */
function toGemini(req: ChatCompletionRequest) {
  const system = req.messages.filter((m) => m.role === 'system').map((m) => String(m.content ?? '')).join('\n');
  const contents = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: Array.isArray(m.content)
        ? m.content.map((p: any) => (p.type === 'text' ? { text: p.text } : { text: JSON.stringify(p) }))
        : [{ text: String(m.content ?? '') }],
    }));
  return {
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    contents,
    generationConfig: {
      temperature: req.temperature,
      topP: req.top_p,
      maxOutputTokens: req.max_tokens,
      stopSequences: typeof req.stop === 'string' ? [req.stop] : req.stop,
    },
    tools: req.tools ? [{ functionDeclarations: req.tools.map((t: any) => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters })) }] : undefined,
  };
}
const mapFinish = (r?: string) => (r === 'STOP' ? 'stop' : r === 'MAX_TOKENS' ? 'length' : r === 'SAFETY' ? 'content_filter' : r ? 'stop' : null);
const textOf = (cand: any) => (cand?.content?.parts ?? []).filter((p: any) => p.text).map((p: any) => p.text).join('');
const usageOf = (j: any) => ({
  prompt_tokens: j.usageMetadata?.promptTokenCount ?? 0,
  completion_tokens: j.usageMetadata?.candidatesTokenCount ?? 0,
  total_tokens: j.usageMetadata?.totalTokenCount ?? 0,
});

async function call(target: UpstreamTarget, req: ChatCompletionRequest, stream: boolean, signal: AbortSignal) {
  const version = target.config.apiVersion ?? 'v1beta';
  const method = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
  const c = await upstreamRequest(`${target.baseUrl}/${version}/models/${target.upstreamModel}:${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': target.apiKey, ...target.extraHeaders },
    body: JSON.stringify(toGemini(req)),
  }, signal, target.config.insecureTls === true);
  if (!c.res.ok) {
    const msg = await readError(c.res).finally(c.finish);
    throw new UpstreamError(c.res.status, msg, isRetriable(c.res.status), isKeyInvalid(c.res.status, msg));
  }
  return c;
}

export const geminiProvider: Provider = {
  async complete(target, req, signal): Promise<ChatCompletionResponse> {
    const c = await call(target, req, false, signal);
    const j: any = await withUpstreamBody(c, signal, (res) => res.json());
    const cand = j.candidates?.[0];
    const fc = (cand?.content?.parts ?? []).filter((p: any) => p.functionCall);
    return {
      id: `gemini-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: req.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: textOf(cand) || null,
          ...(fc.length ? { tool_calls: fc.map((p: any, i: number) => ({ id: `call_${i}`, type: 'function', function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args ?? {}) } })) } : {}),
        },
        finish_reason: fc.length ? 'tool_calls' : mapFinish(cand?.finishReason),
      }],
      usage: usageOf(j),
    };
  },

  async *stream(target, req, signal) {
    const c = await call(target, req, true, signal);
    if (!c.res.body) { c.finish(); throw new UpstreamError(502, 'empty upstream body', true); }
    const id = `gemini-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    let last: any;
    yield { id, object: 'chat.completion.chunk', created, model: req.model, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] };
    try {
      for await (const evt of parseSSE(c.res.body)) {
        const j = JSON.parse(evt.data);
        last = j;
        const cand = j.candidates?.[0];
        const text = textOf(cand);
        if (text) yield { id, object: 'chat.completion.chunk', created, model: req.model, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] };
        if (cand?.finishReason) yield { id, object: 'chat.completion.chunk', created, model: req.model, choices: [{ index: 0, delta: {}, finish_reason: mapFinish(cand.finishReason) }] };
      }
    } catch (err) {
      throw normalizeBodyError(err, signal);
    } finally {
      c.finish();
    }
    yield { id, object: 'chat.completion.chunk', created, model: req.model, choices: [], usage: usageOf(last ?? {}) };
  },
};
