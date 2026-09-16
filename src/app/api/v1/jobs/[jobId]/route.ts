import { NextRequest, NextResponse } from 'next/server';
import { authenticateBearer } from '@/lib/auth';
import { RelayError } from '@/lib/errors';
import { relayQueue } from '@/lib/queue';
import { sseEvent, sseHeaders } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /v1/jobs/:jobId
 *   Accept: text/event-stream -> live progress events (queue position / ETA) then `done` / `failed`
 *   otherwise               -> JSON snapshot
 */
export async function GET(req: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const ctx = await authenticateBearer(req);
    const job = await relayQueue.getJob(params.jobId);
    if (!job || job.data.tokenId !== ctx.token.id) return NextResponse.json({ error: { message: 'job not found', type: 'invalid_request_error' } }, { status: 404 });

    const snapshot = async () => {
      const state = await job.getState();
      return { job_id: job.id, state, progress: job.progress, result: state === 'completed' ? job.returnvalue : undefined, error: state === 'failed' ? job.failedReason : undefined };
    };

    if (!req.headers.get('accept')?.includes('text/event-stream')) return NextResponse.json(await snapshot());

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (ev: string, d: unknown) => { try { controller.enqueue(sseEvent(ev, d)); } catch { /* closed */ } };
        const deadline = Date.now() + 290_000;
        while (Date.now() < deadline && !req.signal.aborted) {
          const s = await snapshot();
          if (s.state === 'completed') { send('done', s); break; }
          if (s.state === 'failed') { send('failed', s); break; }
          send('progress', s);
          await new Promise((r) => setTimeout(r, 1000));
        }
        try { controller.close(); } catch { /* noop */ }
      },
    });
    return new Response(stream, { headers: sseHeaders() });
  } catch (e) {
    if (e instanceof RelayError) return e.toResponse();
    throw e;
  }
}
