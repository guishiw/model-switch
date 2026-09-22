import Redis, { type RedisOptions } from 'ioredis';
import { env } from './env';
import { logger } from './logger';

const g = globalThis as unknown as { redis?: Redis; redisSub?: Redis };

function sentinelOptions(): RedisOptions | null {
  if (!env.REDIS_SENTINELS?.trim()) return null;
  const sentinels = env.REDIS_SENTINELS.split(',').map((entry) => {
    const [host, portText = '26379'] = entry.trim().split(':');
    const port = Number(portText);
    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`Invalid REDIS_SENTINELS entry: ${entry}`);
    }
    return { host, port };
  });
  return {
    sentinels,
    name: env.REDIS_SENTINEL_MASTER_NAME,
    sentinelUsername: env.REDIS_SENTINEL_USERNAME,
    sentinelPassword: env.REDIS_SENTINEL_PASSWORD,
    username: env.REDIS_USERNAME,
    password: env.REDIS_PASSWORD,
    db: env.REDIS_DB,
    sentinelRetryStrategy: (times) => Math.min(times * 500, 5000),
  };
}

function create(name: string) {
  const common: RedisOptions = {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: true,
    lazyConnect: true, // connect on first command; avoids connections during `next build`
  };
  const sentinel = sentinelOptions();
  const client = sentinel ? new Redis({ ...sentinel, ...common }) : new Redis(env.REDIS_URL, common);
  client.on('error', (err) => logger.error({ err, name }, 'redis error'));
  return client;
}

/** General purpose client (commands, Lua scripts) */
export const redis = g.redis ?? create('main');
/** Dedicated subscriber connection (a subscribed connection cannot run other commands) */
export const redisSub = g.redisSub ?? create('sub');

if (env.NODE_ENV !== 'production') {
  g.redis = redis;
  g.redisSub = redisSub;
}
