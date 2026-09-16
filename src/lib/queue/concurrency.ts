import { redis, redisSub } from '../redis';
import { env } from '../env';
import { logger } from '../logger';

/**
 * Global admission control: a Redis semaphore + priority waiting room.
 *
 *   gw:cc:active           -> ZSET of in-flight request ids (score = start ts)  [acts as counter; expired entries pruned]
 *   gw:cc:wait             -> ZSET of waiting request ids (score = (9-tier)*1e13 + enqueue ts)  => priority FIFO
 *   gw:cc:notify           -> pub/sub channel, published on every release
 *
 * The HTTP handler that owns the client connection performs the wait itself, so
 * streaming responses work naturally once a slot is granted.
 */

const ACTIVE = 'gw:cc:active';
const WAIT = 'gw:cc:wait';
const NOTIFY = 'gw:cc:notify';
const STALE_MS = 10 * 60 * 1000; // safety: consider a slot leaked after 10 min

// Returns {granted, position, activeCount}
const TRY_ACQUIRE = `
local active, wait = KEYS[1], KEYS[2]
local id, max, now, score, stale = ARGV[1], tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4]), tonumber(ARGV[5])

-- prune leaked slots
redis.call('ZREMRANGEBYSCORE', active, 0, now - stale)

-- make sure we are registered in the waiting room (idempotent)
if redis.call('ZSCORE', wait, id) == false then
  redis.call('ZADD', wait, score, id)
end

local rank = redis.call('ZRANK', wait, id)
local count = redis.call('ZCARD', active)

if rank == 0 and count < max then
  redis.call('ZREM', wait, id)
  redis.call('ZADD', active, now, id)
  return {1, 0, count + 1}
end
return {0, rank, count}
`;

export type Admission = { granted: boolean; position: number; active: number };

export async function tryAcquire(id: string, tier: number, enqueuedAt: number): Promise<Admission> {
  const score = (9 - Math.min(9, Math.max(0, tier))) * 1e13 + enqueuedAt;
  const [g, pos, active] = (await redis.eval(TRY_ACQUIRE, 2, ACTIVE, WAIT, id, env.GLOBAL_MAX_CONCURRENCY, Date.now(), score, STALE_MS)) as number[];
  return { granted: g === 1, position: pos, active };
}

export async function release(id: string) {
  await redis.multi().zrem(ACTIVE, id).zrem(WAIT, id).publish(NOTIFY, id).exec();
}

export async function leaveQueue(id: string) {
  await redis.zrem(WAIT, id);
}

export async function queueSnapshot() {
  const [active, waiting] = await redis.multi().zcard(ACTIVE).zcard(WAIT).exec() as [any, number][];
  return { active: active[1] as number, waiting: waiting[1] as number, max: env.GLOBAL_MAX_CONCURRENCY };
}

// ---- shared subscriber: wake all local waiters on any release ----
const waiters = new Set<() => void>();
let subscribed = false;
async function ensureSubscribed() {
  if (subscribed) return;
  subscribed = true;
  await redisSub.subscribe(NOTIFY);
  redisSub.on('message', (ch) => {
    if (ch === NOTIFY) for (const w of waiters) w();
  });
}

export type WaitOptions = {
  id: string;
  tier: number;
  maxWaitMs?: number;
  /** Called periodically with queue position (1-based) and ETA seconds */
  onProgress?: (info: { position: number; etaSeconds: number; active: number }) => void;
  signal?: AbortSignal;
};

/**
 * Block until a global slot is granted, the wait times out, or the client disconnects.
 * Resolves with a release() function. Throws 'QUEUE_TIMEOUT' | 'ABORTED'.
 */
export async function acquireSlot(opts: WaitOptions): Promise<{ release: () => Promise<void>; waitedMs: number }> {
  const { id, tier, onProgress, signal } = opts;
  const maxWait = opts.maxWaitMs ?? env.QUEUE_MAX_WAIT_SECONDS * 1000;
  const enqueuedAt = Date.now();

  const first = await tryAcquire(id, tier, enqueuedAt);
  if (first.granted) return { release: () => release(id), waitedMs: 0 };

  await ensureSubscribed();
  logger.debug({ id, position: first.position }, 'request queued');

  return new Promise((resolve, reject) => {
    let done = false;
    const cleanup = () => {
      done = true;
      waiters.delete(wake);
      clearInterval(ticker);
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = async (err?: Error) => {
      if (done) return;
      cleanup();
      if (err) {
        await leaveQueue(id);
        reject(err);
      }
    };
    const attempt = async () => {
      if (done) return;
      try {
        const r = await tryAcquire(id, tier, enqueuedAt);
        if (r.granted && !done) {
          cleanup();
          resolve({ release: () => release(id), waitedMs: Date.now() - enqueuedAt });
        } else if (!done) {
          // crude ETA: assume average service time of 8s per slot
          onProgress?.({ position: r.position + 1, active: r.active, etaSeconds: Math.ceil(((r.position + 1) / Math.max(1, env.GLOBAL_MAX_CONCURRENCY)) * 8) });
        }
      } catch (e) {
        finish(e as Error);
      }
    };
    const wake = () => void attempt();
    const onAbort = () => finish(new Error('ABORTED'));

    waiters.add(wake);
    const ticker = setInterval(attempt, env.QUEUE_PROGRESS_INTERVAL_MS);
    const timer = setTimeout(() => finish(new Error('QUEUE_TIMEOUT')), maxWait);
    signal?.addEventListener('abort', onAbort);
  });
}
