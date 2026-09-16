import { redis } from '../redis';

/**
 * Atomic token-bucket in Redis (Lua).
 * KEYS[1] = bucket key
 * ARGV = capacity, refillPerSec, nowMs, cost
 * Returns [allowed(0/1), remaining, retryAfterMs]
 */
const LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then tokens = capacity; ts = now end

local elapsed = math.max(0, now - ts) / 1000
tokens = math.min(capacity, tokens + elapsed * refill)

local allowed = 0
local retry = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retry = math.ceil((cost - tokens) / refill * 1000)
end

redis.call('HSET', key, 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', key, math.ceil(capacity / refill * 1000) + 1000)
return {allowed, math.floor(tokens), retry}
`;

let sha: string | undefined;

export type BucketResult = { allowed: boolean; remaining: number; retryAfterMs: number };

/**
 * @param key      unique bucket id, e.g. gw:rl:rpm:token:<id>
 * @param perMinute allowed events per minute (capacity == perMinute, refill == perMinute/60)
 * @param cost     tokens to consume (1 for RPM, N tokens for TPM)
 */
export async function consume(key: string, perMinute: number, cost = 1): Promise<BucketResult> {
  if (perMinute <= 0) return { allowed: true, remaining: Infinity, retryAfterMs: 0 };
  const args = [key, perMinute, perMinute / 60, Date.now(), cost];
  let res: [number, number, number];
  try {
    if (!sha) sha = await redis.script('LOAD', LUA) as string;
    res = (await redis.evalsha(sha, 1, ...args)) as [number, number, number];
  } catch (e: any) {
    if (String(e?.message).includes('NOSCRIPT')) {
      sha = undefined;
      res = (await redis.eval(LUA, 1, ...args)) as [number, number, number];
    } else throw e;
  }
  return { allowed: res[0] === 1, remaining: res[1], retryAfterMs: res[2] };
}
