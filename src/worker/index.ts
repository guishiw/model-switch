import 'dotenv/config';
import { Worker, type Job } from 'bullmq';
import { redis } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { env } from '../lib/env';
import { acquireSlot } from '../lib/queue/concurrency';
import { relayComplete, computeCost } from '../lib/relay/engine';
import { persistTurn } from '../lib/session';
import { statsQueue, type LogJobData, type RelayJobData } from '../lib/queue';
import { RelayError } from '../lib/errors';

const prefix = process.env.QUEUE_PREFIX ?? 'ms';
import { rollupHour } from './stats';
import { markRunning } from '../lib/request-log';

/**
 * Task scheduling layer.
 *  - relay worker: executes queued async completions (goes through the same global concurrency gate)
 *  - log worker:   persists RequestLog + token accounting + session turns
 *  - stats worker: hourly rollups
 */

const relayWorker = new Worker<RelayJobData>(
  'relay',
  async (job: Job<RelayJobData>) => {
    const { requestId, request, tier } = job.data;
    const started = Date.now();
    const slot = await acquireSlot({
      id: requestId,
      tier,
      maxWaitMs: env.QUEUE_MAX_WAIT_SECONDS * 1000 * 5, // async jobs may wait longer
      onProgress: (p) => job.updateProgress({ position: p.position, etaSeconds: p.etaSeconds }),
    });
    markRunning(requestId, slot.waitedMs);
    try {
      const { response, meta } = await relayComplete(requestId, request, new AbortController().signal);
      await logQueueAdd({
        requestId, tokenId: job.data.tokenId, channelId: meta.selection.target.channelId, apiKeyId: meta.selection.target.apiKeyId,
        publicModel: request.model, upstreamModel: meta.selection.target.upstreamModel, status: 'SUCCESS', httpStatus: 200, stream: false,
        usage: meta.usage, cost: computeCost(meta.usage, meta.selection.pricing), latencyMs: Date.now() - started, queueWaitMs: slot.waitedMs,
        ttfbMs: meta.ttfbMs, retries: meta.retries, clientIp: job.data.clientIp, requestBody: request, responseBody: response,
        sessionId: request.session_id, outputText: meta.outputText,
      });
      return response;
    } catch (err) {
      const e = err instanceof RelayError ? err : new RelayError(500, (err as Error).message);
      await logQueueAdd({
        requestId, tokenId: job.data.tokenId, publicModel: request.model, status: 'FAILED', httpStatus: e.status, stream: false,
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, cost: 0, latencyMs: Date.now() - started, queueWaitMs: slot.waitedMs,
        retries: 0, errorMessage: e.message, requestBody: request,
      });
      throw e;
    } finally {
      await slot.release();
    }
  },
  { connection: redis, prefix, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 20) },
);

async function logQueueAdd(data: LogJobData) {
  const { logQueue } = await import('../lib/queue');
  await logQueue.add('log', data);
}

const logWorker = new Worker<LogJobData>(
  'logs',
  async (job) => {
    const d = job.data;
    const fields = {
      tokenId: d.tokenId, channelId: d.channelId, apiKeyId: d.apiKeyId, publicModel: d.publicModel,
      upstreamModel: d.upstreamModel, status: d.status, httpStatus: d.httpStatus, stream: d.stream,
      promptTokens: d.usage.prompt_tokens, completionTokens: d.usage.completion_tokens, totalTokens: d.usage.total_tokens,
      cost: d.cost, latencyMs: d.latencyMs, queueWaitMs: d.queueWaitMs, ttfbMs: d.ttfbMs, retries: d.retries,
      clientIp: d.clientIp, userAgent: d.userAgent, errorMessage: d.errorMessage,
      requestBody: d.requestBody as any, responseBody: d.responseBody as any,
    };
    // The route creates the QUEUED row synchronously; here we finalize it (create as fallback).
    const log = await prisma.requestLog.upsert({ where: { requestId: d.requestId }, update: fields, create: { requestId: d.requestId, ...fields } });
    if (d.tokenId && d.usage.total_tokens > 0) {
      await prisma.accessToken.update({ where: { id: d.tokenId }, data: { tokensUsed: { increment: d.usage.total_tokens }, lastUsedAt: new Date() } });
      // bust auth cache so quota enforcement sees fresh counters
      const t = await prisma.accessToken.findUnique({ where: { id: d.tokenId }, select: { tokenHash: true } });
      if (t) await redis.del(`gw:auth:${t.tokenHash}`);
    }
    if (d.apiKeyId) await prisma.apiKey.update({ where: { id: d.apiKeyId }, data: { lastUsedAt: new Date() } }).catch(() => {});
    if (d.sessionId && d.status === 'SUCCESS' && d.outputText) {
      const req = d.requestBody as any;
      await persistTurn(d.sessionId, req?.messages ?? [], d.outputText, log.id);
    }
  },
  { connection: redis, prefix, concurrency: 10 },
);

const statsWorker = new Worker('stats', async () => rollupHour(prisma), { connection: redis, prefix });

async function main() {
  await statsQueue.add('rollup', {}, { repeat: { every: 5 * 60 * 1000 }, jobId: 'rollup-hourly' });
  logger.info('worker started');
  for (const w of [relayWorker, logWorker, statsWorker]) {
    w.on('failed', (job, err) => logger.error({ queue: w.name, jobId: job?.id, err: err.message }, 'job failed'));
  }
  const shutdown = async () => {
    logger.info('worker shutting down');
    await Promise.all([relayWorker.close(), logWorker.close(), statsWorker.close()]);
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
main().catch((err) => { logger.fatal({ err }, 'worker crashed'); process.exit(1); });
