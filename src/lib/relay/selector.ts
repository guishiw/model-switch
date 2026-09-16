import { prisma } from '../prisma';
import { redis } from '../redis';
import { decrypt } from '../crypto';
import { circuitState } from '../circuit-breaker';
import { checkChannelLimits } from '../ratelimit';
import { acquireChannelSlot } from '../queue/channel-concurrency';
import { logger } from '../logger';
import type { UpstreamTarget } from './types';

type Candidate = Awaited<ReturnType<typeof loadCandidates>>[number];

const CACHE_TTL = 15;

/** Cached list of enabled mappings + channels + keys for a public model */
async function loadCandidates(publicModel: string) {
  const cacheKey = `gw:routes:${publicModel}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached) as Awaited<ReturnType<typeof query>>;
  const rows = await query();
  await redis.set(cacheKey, JSON.stringify(rows), 'EX', CACHE_TTL);
  return rows;

  function query() {
    return prisma.modelMapping.findMany({
      where: { publicModel, enabled: true, channel: { status: { in: ['ACTIVE', 'CIRCUIT_OPEN'] } } },
      include: {
        channel: { include: { keys: { where: { enabled: true } } } },
        paramTemplate: true,
      },
    });
  }
}

export async function invalidateRouteCache(publicModel?: string) {
  if (publicModel) return redis.del(`gw:routes:${publicModel}`);
  const keys = await redis.keys('gw:routes:*');
  if (keys.length) await redis.del(...keys);
}

/** Weighted random pick */
function weightedPick<T extends { weight: number }>(items: T[]): T {
  const total = items.reduce((s, i) => s + Math.max(1, i.weight), 0);
  let r = Math.random() * total;
  for (const i of items) {
    r -= Math.max(1, i.weight);
    if (r <= 0) return i;
  }
  return items[items.length - 1];
}

/** Smooth round-robin across keys of one channel via Redis INCR */
async function pickKey(channelId: string, keys: Candidate['channel']['keys']) {
  if (keys.length === 1) return keys[0];
  const idx = await redis.incr(`gw:rr:key:${channelId}`);
  // combine round-robin with weights: expand list by weight
  const expanded = keys.flatMap((k) => Array(Math.max(1, k.weight)).fill(k));
  return expanded[idx % expanded.length];
}

export type Selection = {
  target: UpstreamTarget;
  defaultParams: Record<string, unknown>;
  pricing: { input: number; output: number };
  /** Releases the channel/model concurrency slot. Must be called exactly once when the request finishes. */
  release: () => Promise<void>;
};

export type SelectResult = { selection: Selection | null; /** true if at least one candidate was skipped only because it is at capacity */ busy: boolean };

/**
 * Choose an upstream for `publicModel`, skipping channels that are
 * excluded (already failed this request), circuit-open, or rate-limited.
 */
export async function selectUpstream(requestId: string, publicModel: string, estimatedTokens: number, exclude: Set<string>): Promise<SelectResult> {
  const candidates = (await loadCandidates(publicModel)).filter(
    (c) => !exclude.has(c.channelId) && c.channel.keys.length > 0,
  );
  let busy = false;
  if (!candidates.length) return { selection: null, busy };

  // sort by priority desc, then try weighted picks within the top priority group
  const maxPriority = Math.max(...candidates.map((c) => c.channel.priority));
  const pool = candidates.filter((c) => c.channel.priority === maxPriority);
  const rest = candidates.filter((c) => c.channel.priority !== maxPriority);
  const ordered: Candidate[] = [];
  while (pool.length) {
    const p = weightedPick(pool.map((c) => ({ ...c, weight: c.channel.weight })));
    ordered.push(p);
    pool.splice(pool.findIndex((c) => c.id === p.id), 1);
  }
  ordered.push(...rest.sort((a, b) => b.channel.priority - a.channel.priority));

  for (const c of ordered) {
    const state = await circuitState(c.channelId);
    if (state === 'open') continue;

    const key = await pickKey(c.channelId, c.channel.keys);
    const retryAfter = await checkChannelLimits(c.channel, key, estimatedTokens);
    if (retryAfter > 0) {
      logger.debug({ channel: c.channel.name, retryAfter }, 'channel rate-limited, skipping');
      continue;
    }

    // per-channel / per-model concurrency (values come from the route cache; admin edits bust it)
    const slot = await acquireChannelSlot(requestId, c.channelId, publicModel, c.channel.maxConcurrency, c.maxConcurrency);
    if (!slot.ok) {
      busy = true;
      logger.debug({ channel: c.channel.name, limit: slot.reason }, 'channel at capacity, skipping');
      continue;
    }

    return { busy, selection: {
      release: slot.release,
      target: {
        channelId: c.channelId,
        channelName: c.channel.name,
        provider: c.channel.provider,
        baseUrl: c.channel.baseUrl.replace(/\/+$/, ''),
        apiKeyId: key.id,
        apiKey: decrypt(key.encryptedKey),
        upstreamModel: c.upstreamModel,
        extraHeaders: (c.channel.extraHeaders as Record<string, string>) ?? {},
        config: (c.channel.config as Record<string, any>) ?? {},
      },
      defaultParams: (c.paramTemplate?.params as Record<string, unknown>) ?? {},
      pricing: { input: Number(c.inputPricePerM), output: Number(c.outputPricePerM) },
    } };
  }
  return { selection: null, busy };
}

/** Disable a key after a definitive auth/quota error and bust caches */
export async function disableKey(apiKeyId: string, reason: string) {
  const k = await prisma.apiKey.update({ where: { id: apiKeyId }, data: { enabled: false, disabledReason: reason }, include: { channel: { include: { modelMappings: true } } } });
  await Promise.all(k.channel.modelMappings.map((m) => invalidateRouteCache(m.publicModel)));
  logger.warn({ apiKeyId, reason }, 'api key auto-disabled');
}

export async function listPublicModels() {
  const rows = await prisma.modelMapping.findMany({ where: { enabled: true, channel: { status: 'ACTIVE' } }, select: { publicModel: true }, distinct: ['publicModel'] });
  return rows.map((r) => r.publicModel);
}
