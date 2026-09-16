import { consume } from './token-bucket';
import { Errors } from '../errors';
import type { AccessToken, ApiKey, Channel } from '@prisma/client';

/**
 * Per-request pre-checks on the consumer token (RPM + estimated TPM).
 * Throws RelayError(429) with Retry-After.
 */
export async function checkTokenLimits(token: AccessToken, estimatedTokens: number) {
  if (token.rpmLimit > 0) {
    const r = await consume(`gw:rl:rpm:token:${token.id}`, token.rpmLimit, 1);
    if (!r.allowed) throw Errors.rateLimited('Token RPM limit exceeded', r.retryAfterMs / 1000);
  }
  if (token.tpmLimit > 0) {
    const r = await consume(`gw:rl:tpm:token:${token.id}`, token.tpmLimit, estimatedTokens);
    if (!r.allowed) throw Errors.rateLimited('Token TPM limit exceeded', r.retryAfterMs / 1000);
  }
}

/**
 * Channel + key limits. Returns retryAfterMs > 0 when the channel/key should be skipped
 * (the balancer will try the next candidate instead of failing the request).
 */
export async function checkChannelLimits(channel: Channel, key: ApiKey, estimatedTokens: number): Promise<number> {
  const checks: Array<[string, number, number]> = [
    [`gw:rl:rpm:channel:${channel.id}`, channel.rpmLimit, 1],
    [`gw:rl:tpm:channel:${channel.id}`, channel.tpmLimit, estimatedTokens],
    [`gw:rl:rpm:key:${key.id}`, key.rpmLimit, 1],
    [`gw:rl:tpm:key:${key.id}`, key.tpmLimit, estimatedTokens],
  ];
  for (const [k, limit, cost] of checks) {
    if (limit <= 0) continue;
    const r = await consume(k, limit, cost);
    if (!r.allowed) return r.retryAfterMs;
  }
  return 0;
}
