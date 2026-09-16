import Redis from 'ioredis';
import { env } from './env';
import { logger } from './logger';

const g = globalThis as unknown as { redis?: Redis; redisSub?: Redis };

function create(name: string) {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: true,
    lazyConnect: true, // connect on first command; avoids connections during `next build`
  });
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
