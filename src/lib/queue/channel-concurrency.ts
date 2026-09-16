import { redis } from '../redis';

/**
 * Per-channel and per-model in-flight limits (Redis semaphores).
 *   gw:cc:channel:<channelId>            -> ZSET of request ids (score = start ts)
 *   gw:cc:model:<channelId>:<publicModel> -> ZSET of request ids
 * Limits are passed on every acquire, so changes made in the admin UI apply immediately
 * (route cache is invalidated on save). Leaked entries are pruned after STALE_MS.
 */
const STALE_MS = 10 * 60 * 1000;

const ACQUIRE = `
local chan, model = KEYS[1], KEYS[2]
local id, chanLimit, modelLimit, now, stale = ARGV[1], tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4]), tonumber(ARGV[5])
redis.call('ZREMRANGEBYSCORE', chan, 0, now - stale)
redis.call('ZREMRANGEBYSCORE', model, 0, now - stale)
if chanLimit > 0 and redis.call('ZCARD', chan) >= chanLimit then return {0, 'channel'} end
if modelLimit > 0 and redis.call('ZCARD', model) >= modelLimit then return {0, 'model'} end
redis.call('ZADD', chan, now, id)
redis.call('ZADD', model, now, id)
redis.call('PEXPIRE', chan, stale)
redis.call('PEXPIRE', model, stale)
return {1, ''}
`;

export const channelKey = (channelId: string) => `gw:cc:channel:${channelId}`;
export const modelKey = (channelId: string, publicModel: string) => `gw:cc:model:${channelId}:${publicModel}`;

export type SlotAcquire = { ok: true; release: () => Promise<void> } | { ok: false; reason: 'channel' | 'model' };

export async function acquireChannelSlot(requestId: string, channelId: string, publicModel: string, chanLimit: number, modelLimit: number): Promise<SlotAcquire> {
  if (chanLimit <= 0 && modelLimit <= 0) return { ok: true, release: async () => {} };
  const ck = channelKey(channelId), mk = modelKey(channelId, publicModel);
  const [ok, reason] = (await redis.eval(ACQUIRE, 2, ck, mk, requestId, chanLimit, modelLimit, Date.now(), STALE_MS)) as [number, string];
  if (ok !== 1) return { ok: false, reason: reason as 'channel' | 'model' };
  return { ok: true, release: async () => { await redis.multi().zrem(ck, requestId).zrem(mk, requestId).exec(); } };
}

/** Live in-flight counts for the admin UI */
export async function inflightCounts(channels: Array<{ id: string; models: string[] }>) {
  const pipe = redis.multi();
  for (const c of channels) {
    pipe.zcard(channelKey(c.id));
    for (const m of c.models) pipe.zcard(modelKey(c.id, m));
  }
  const res = (await pipe.exec()) ?? [];
  let i = 0;
  const out: Record<string, { channel: number; models: Record<string, number> }> = {};
  for (const c of channels) {
    const channel = Number(res[i++]?.[1] ?? 0);
    const models: Record<string, number> = {};
    for (const m of c.models) models[m] = Number(res[i++]?.[1] ?? 0);
    out[c.id] = { channel, models };
  }
  return out;
}
