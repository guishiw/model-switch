import { redis } from './redis';
import { prisma } from './prisma';
import { env } from './env';
import { logger } from './logger';

/**
 * Per-channel circuit breaker stored in Redis.
 *   gw:cb:<channelId> = hash { failures, state, openedAt }
 * States: closed -> open (after N consecutive failures) -> half-open (after cooldown, allow 1 probe) -> closed/open
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

const key = (id: string) => `gw:cb:${id}`;

export async function circuitState(channelId: string): Promise<CircuitState> {
  const [state, openedAt] = await redis.hmget(key(channelId), 'state', 'openedAt');
  if (state !== 'open') return (state as CircuitState) ?? 'closed';
  const elapsed = Date.now() - Number(openedAt ?? 0);
  if (elapsed >= env.CIRCUIT_OPEN_SECONDS * 1000) {
    // Allow a single probe request through
    const set = await redis.hsetnx(key(channelId), 'probe', '1');
    if (set) {
      await redis.hset(key(channelId), 'state', 'half-open');
      return 'half-open';
    }
  }
  return 'open';
}

export async function recordSuccess(channelId: string) {
  const k = key(channelId);
  const state = await redis.hget(k, 'state');
  await redis.del(k);
  if (state === 'open' || state === 'half-open') {
    logger.info({ channelId }, 'circuit closed');
    await prisma.channel.updateMany({ where: { id: channelId, status: 'CIRCUIT_OPEN' }, data: { status: 'ACTIVE' } });
  }
}

export async function recordFailure(channelId: string) {
  const k = key(channelId);
  const failures = await redis.hincrby(k, 'failures', 1);
  const state = await redis.hget(k, 'state');
  await redis.expire(k, env.CIRCUIT_OPEN_SECONDS * 10);

  if (state === 'half-open' || failures >= env.CIRCUIT_FAILURE_THRESHOLD) {
    await redis.hset(k, { state: 'open', openedAt: Date.now(), failures: 0 });
    await redis.hdel(k, 'probe');
    logger.warn({ channelId, failures }, 'circuit opened');
    await prisma.channel.updateMany({ where: { id: channelId, status: 'ACTIVE' }, data: { status: 'CIRCUIT_OPEN' } });
  }
}
