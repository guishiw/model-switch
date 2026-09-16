import { NextRequest, NextResponse } from 'next/server';
import { authenticateBearer, allowedModelsOf } from '@/lib/auth';
import { Errors, RelayError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';
import { checkTokenLimits } from '@/lib/ratelimit';
import { acquireSlot } from '@/lib/queue/concurrency';
import { enqueueLog, enqueueRelay, type LogJobData } from '@/lib/queue';
import { ChatCompletionRequestSchema, type ChatCompletionRequest } from '@/lib/relay/types';
import { relayComplete, relayStream, computeCost } from '@/lib/relay/engine';
import { countMessages } from '@/lib/relay/tokens';
import { auditText, createStreamAuditor, recordAuditHit } from '@/lib/audit';
import { buildSessionContext } from '@/lib/session';
import { clientIp, sseComment, sseData, sseEvent, sseHeaders } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /v1/chat/completions — OpenAI compatible.
 *
 * Pipeline:
 *   auth -> validate -> token rate limits -> content audit (input) -> session context
 *   -> global concurrency gate (queue w/ priority + progress) -> relay (failover/retry)
 *   -> audit (output) -> async logging
 *
 * Headers:
 *   X-Async: true        -> enqueue and return {job_id}; poll GET /v1/jobs/:id (SSE)
 *   X-Queue-Progress: 1  -> for stream=true, emit `event: queue` progress frames while waiting
 */
export async function POST(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
  const started = Date.now();
  const ip = clientIp(req);
  const ua = req.headers.get('user-agent') ?? undefined;
  const log = logger.child({ requestId });

  let ctx: Awaited<ReturnType<typeof authenticateBearer>> | undefined;
  let body: ChatCompletionRequest | undefined;

  const fail = (e: RelayError, status: LogJobData['status'] = 'FAILED', queueWaitMs = 0) => {
    enqueueLog({
      requestId, tokenId: ctx?.token.id, publicModel: body?.model ?? 'unknown', status, httpStatus: e.status, stream: body?.stream ?? false,
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, cost: 0, latencyMs: Date.now() - started, queueWaitMs,
      retries: 0, clientIp: ip, userAgent: ua, errorMessage: e.message, requestBody: body,
    });
    return e.toResponse();
  };

  try {
    // 1. auth
    ctx = await authenticateBearer(req);

    // 2. validate
    const parsed = ChatCompletionRequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw Errors.badRequest(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    body = parsed.data;
    const allowed = allowedModelsOf(ctx.token);
    if (allowed.length && !allowed.includes(body.model)) throw Errors.forbidden(`model '${body.model}' not allowed for this token`);

    // 3. session context
    if (body.session_id) body.messages = await buildSessionContext(body.session_id, ctx.user.id, body.messages);

    // 4. token-level rate limits (RPM / TPM estimate)
    const estimated = countMessages(body.messages) + (body.max_tokens ?? 1024);
    await checkTokenLimits(ctx.token, estimated);

    // 5. input audit
    const inputText = body.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''))).join('\n');
    const audit = await auditText(inputText);
    if (audit.blocked) {
      await recordAuditHit(requestId, 'input', audit.matched, inputText);
      return fail(Errors.audit(audit.matched), 'REJECTED_AUDIT');
    }

    // 6. async mode -> BullMQ
    if (req.headers.get('x-async') === 'true') {
      if (body.stream) throw Errors.badRequest('stream=true is not supported with X-Async');
      await enqueueRelay({ requestId, tokenId: ctx.token.id, userId: ctx.user.id, tier: ctx.user.tier, clientIp: ip, request: body });
      return NextResponse.json({ job_id: requestId, status: 'queued', poll: `/v1/jobs/${requestId}` }, { status: 202, headers: { 'x-request-id': requestId } });
    }

    const wantProgress = body.stream && req.headers.get('x-queue-progress') === '1';
    return body.stream
      ? await handleStream(requestId, ctx, body, req, started, ip, ua, wantProgress ?? false)
      : await handleNonStream(requestId, ctx, body, req, started, ip, ua);
  } catch (err) {
    if (err instanceof RelayError) {
      const status: LogJobData['status'] = err.status === 429 ? 'REJECTED_RATE_LIMIT' : err.code === 'queue_timeout' ? 'QUEUE_TIMEOUT' : 'FAILED';
      return fail(err, status);
    }
    log.error({ err }, 'unhandled relay error');
    return fail(new RelayError(500, 'Internal server error', 'server_error'));
  }
}

type Ctx = Awaited<ReturnType<typeof authenticateBearer>>;

async function handleNonStream(requestId: string, ctx: Ctx, body: ChatCompletionRequest, req: NextRequest, started: number, ip?: string, ua?: string) {
  const slot = await acquireSlot({ id: requestId, tier: ctx.user.tier, signal: req.signal }).catch((e: Error) => {
    if (e.message === 'QUEUE_TIMEOUT') throw Errors.queueTimeout(10);
    throw e;
  });
  try {
    const { response, meta } = await relayComplete(requestId, body, req.signal);

    const out = await auditText(meta.outputText);
    if (out.blocked) {
      await recordAuditHit(requestId, 'output', out.matched, meta.outputText);
      throw Errors.audit(out.matched);
    }

    enqueueLog({
      requestId, tokenId: ctx.token.id, channelId: meta.selection.target.channelId, apiKeyId: meta.selection.target.apiKeyId,
      publicModel: body.model, upstreamModel: meta.selection.target.upstreamModel, status: 'SUCCESS', httpStatus: 200, stream: false,
      usage: meta.usage, cost: computeCost(meta.usage, meta.selection.pricing), latencyMs: Date.now() - started, queueWaitMs: slot.waitedMs,
      ttfbMs: meta.ttfbMs, retries: meta.retries, clientIp: ip, userAgent: ua, requestBody: body, responseBody: response,
      sessionId: body.session_id, outputText: meta.outputText,
    });
    return NextResponse.json(response, { headers: { 'x-request-id': requestId, 'x-relay-channel': meta.selection.target.channelName, 'x-queue-wait-ms': String(slot.waitedMs) } });
  } finally {
    await slot.release();
  }
}

async function handleStream(requestId: string, ctx: Ctx, body: ChatCompletionRequest, req: NextRequest, started: number, ip: string | undefined, ua: string | undefined, progress: boolean) {
  const log = logger.child({ requestId });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (b: Uint8Array) => { try { controller.enqueue(b); } catch { /* client gone */ } };
      let slot: Awaited<ReturnType<typeof acquireSlot>> | undefined;
      let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      let logged = false;

      try {
        // Queue wait. Keep the connection warm with SSE comments / progress events.
        slot = await acquireSlot({
          id: requestId,
          tier: ctx.user.tier,
          signal: req.signal,
          onProgress: (p) => send(progress ? sseEvent('queue', { position: p.position, eta_seconds: p.etaSeconds, active: p.active }) : sseComment(`queued position=${p.position}`)),
        });

        const auditor = createStreamAuditor();
        const gen = relayStream(requestId, body, req.signal);
        let meta: Awaited<ReturnType<typeof gen.return>>['value'] | undefined;

        while (true) {
          const { value, done } = await gen.next();
          if (done) { meta = value; break; }
          const delta = value.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta) {
            const r = await auditor.check(delta);
            if (r.blocked) {
              await recordAuditHit(requestId, 'output', r.matched, delta);
              send(sseData({ error: { message: `Content blocked by policy: ${r.matched.join(', ')}`, type: 'content_policy_violation', code: 'content_filter' } }));
              send(encoder.encode('data: [DONE]\n\n'));
              enqueueLog(base('REJECTED_AUDIT', 400, slot.waitedMs, meta, `blocked: ${r.matched.join(',')}`));
              logged = true;
              return controller.close();
            }
          }
          send(sseData(value));
        }
        send(encoder.encode('data: [DONE]\n\n'));
        usage = meta!.usage;
        enqueueLog({ ...base('SUCCESS', 200, slot.waitedMs, meta), sessionId: body.session_id, outputText: meta!.outputText });
        logged = true;
        controller.close();
      } catch (err) {
        const e = err instanceof RelayError ? err : (err as Error).message === 'QUEUE_TIMEOUT' ? Errors.queueTimeout(10) : (err as Error).message === 'ABORTED' ? new RelayError(499, 'client closed request') : new RelayError(502, (err as Error)?.message ?? 'stream failed', 'upstream_error');
        if (e.status !== 499) log.warn({ err: e.message, status: e.status }, 'stream failed');
        send(sseData({ error: { message: e.message, type: e.type, code: e.code ?? null } }));
        send(encoder.encode('data: [DONE]\n\n'));
        if (!logged) enqueueLog(base(e.code === 'queue_timeout' ? 'QUEUE_TIMEOUT' : 'FAILED', e.status, slot?.waitedMs ?? 0, undefined, e.message));
        try { controller.close(); } catch { /* already closed */ }
      } finally {
        await slot?.release();
      }

      function base(status: LogJobData['status'], httpStatus: number, queueWaitMs: number, meta: any, errorMessage?: string): LogJobData {
        return {
          requestId, tokenId: ctx.token.id, channelId: meta?.selection.target.channelId, apiKeyId: meta?.selection.target.apiKeyId,
          publicModel: body.model, upstreamModel: meta?.selection.target.upstreamModel, status, httpStatus, stream: true,
          usage: meta?.usage ?? usage, cost: meta ? computeCost(meta.usage, meta.selection.pricing) : 0, latencyMs: Date.now() - started, queueWaitMs,
          ttfbMs: meta?.ttfbMs, retries: meta?.retries ?? 0, clientIp: ip, userAgent: ua, errorMessage, requestBody: body,
          responseBody: meta ? { text: meta.outputText, finish_reason: meta.finishReason } : undefined,
        };
      }
    },
    cancel() { log.debug('client cancelled stream'); },
  });

  return new Response(stream, { headers: sseHeaders({ 'x-request-id': requestId }) });
}

const encoder = new TextEncoder();
