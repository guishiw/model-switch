import { Queue, QueueEvents, type JobsOptions } from 'bullmq';
import { redis } from '../redis';
import { env } from '../env';
import type { ChatCompletionRequest } from '../relay/types';
import type { RequestStatus } from '@prisma/client';

/**
 * BullMQ queues:
 *  - `relay`   : async (non-streaming) chat completions executed by the worker (X-Async: true)
 *  - `logs`    : fire-and-forget request logging + usage accounting (keeps the hot path fast)
 *  - `stats`   : hourly rollups (repeatable)
 *  - `relay-dead-letter`: terminal async failures awaiting operator action
 */
const connection = redis;
/** Key prefix so the gateway's queues don't collide with other apps sharing this Redis db */
const prefix = process.env.QUEUE_PREFIX ?? 'ms';

export type RelayJobData = {
  requestId: string;
  tokenId: string;
  userId: string;
  tier: number;
  clientIp?: string;
  request: ChatCompletionRequest;
};

export type RelayDeadLetterData = RelayJobData & {
  originalJobId: string;
  attemptsMade: number;
  failedAt: string;
  errorMessage: string;
};

export type LogJobData = {
  requestId: string;
  tokenId?: string;
  channelId?: string;
  apiKeyId?: string;
  publicModel: string;
  upstreamModel?: string;
  status: RequestStatus;
  httpStatus: number;
  stream: boolean;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  cost: number;
  latencyMs: number;
  queueWaitMs: number;
  ttfbMs?: number;
  retries: number;
  clientIp?: string;
  userAgent?: string;
  errorMessage?: string;
  requestBody?: unknown;
  responseBody?: unknown;
  sessionId?: string;
  outputText?: string;
};

const g = globalThis as unknown as { relayQueue?: Queue<RelayJobData>; logQueue?: Queue<LogJobData>; statsQueue?: Queue; relayDeadLetterQueue?: Queue<RelayDeadLetterData> };

export const relayQueue = g.relayQueue ?? new Queue<RelayJobData>('relay', { connection, prefix, defaultJobOptions: {
  removeOnComplete: { age: 3600 },
  removeOnFail: { age: 604800 },
  attempts: env.ASYNC_JOB_ATTEMPTS,
  backoff: { type: 'exponential', delay: env.ASYNC_JOB_BACKOFF_MS },
} });
export const logQueue = g.logQueue ?? new Queue<LogJobData>('logs', { connection, prefix, defaultJobOptions: { removeOnComplete: true, removeOnFail: { age: 86400 }, attempts: 3, backoff: { type: 'exponential', delay: 1000 } } });
export const statsQueue = g.statsQueue ?? new Queue('stats', { connection, prefix, defaultJobOptions: { removeOnComplete: true } });
export const relayDeadLetterQueue = g.relayDeadLetterQueue ?? new Queue<RelayDeadLetterData>('relay-dead-letter', {
  connection,
  prefix,
  defaultJobOptions: { removeOnComplete: false, removeOnFail: false },
});

if (process.env.NODE_ENV !== 'production') Object.assign(g, { relayQueue, logQueue, statsQueue, relayDeadLetterQueue });

/** BullMQ priority: lower number = higher priority. tier 9 -> 1, tier 0 -> 10 */
export const tierToPriority = (tier: number) => 10 - Math.min(9, Math.max(0, tier));

export function enqueueRelay(data: RelayJobData, opts: JobsOptions = {}) {
  return relayQueue.add('chat', data, { jobId: data.requestId, priority: tierToPriority(data.tier), ...opts });
}

export function enqueueLog(data: LogJobData) {
  return logQueue.add('log', data).catch(() => { /* never fail a request because logging failed */ });
}

export const relayQueueEvents = () => new QueueEvents('relay', { connection: redis.duplicate(), prefix });
