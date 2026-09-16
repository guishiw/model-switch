import { NextRequest } from 'next/server';
import { SignJWT, jwtVerify } from 'jose';
import { prisma } from './prisma';
import { redis } from './redis';
import { sha256 } from './crypto';
import { Errors } from './errors';
import { env } from './env';
import type { AccessToken, User } from '@prisma/client';

export type AuthContext = { token: AccessToken; user: User };

const TOKEN_CACHE_TTL = 30; // seconds

/**
 * Resolve `Authorization: Bearer sk-...` to an AccessToken + User.
 * Cached in Redis by hash for 30s to keep hot path off Postgres.
 */
export async function authenticateBearer(req: NextRequest): Promise<AuthContext> {
  const header = req.headers.get('authorization') ?? req.headers.get('x-api-key') ?? '';
  const raw = header.replace(/^Bearer\s+/i, '').trim();
  if (!raw) throw Errors.unauthorized();

  const hash = sha256(raw);
  const cacheKey = `gw:auth:${hash}`;

  const cached = await redis.get(cacheKey);
  let ctx: AuthContext | null = cached ? JSON.parse(cached, bigintReviver) : null;

  if (!ctx) {
    const token = await prisma.accessToken.findUnique({ where: { tokenHash: hash }, include: { user: true } });
    if (!token) throw Errors.unauthorized();
    const { user, ...t } = token;
    ctx = { token: t, user };
    await redis.set(cacheKey, JSON.stringify(ctx, bigintReplacer), 'EX', TOKEN_CACHE_TTL);
  }

  if (!ctx.token.enabled) throw Errors.forbidden('Token disabled');
  if (ctx.token.expiresAt && new Date(ctx.token.expiresAt) < new Date()) throw Errors.forbidden('Token expired');
  if (ctx.token.tokenQuota > 0n && ctx.token.tokensUsed >= ctx.token.tokenQuota) throw Errors.quotaExceeded();

  return ctx;
}

export async function invalidateTokenCache(tokenHash: string) {
  await redis.del(`gw:auth:${tokenHash}`);
}

// ---- admin session (cookie JWT) ----
const secret = new TextEncoder().encode(env.ADMIN_JWT_SECRET);
export const ADMIN_COOKIE = 'relay_admin';

export async function signAdminJwt(userId: string) {
  return new SignJWT({ sub: userId, role: 'ADMIN' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(secret);
}

export async function verifyAdminJwt(token: string | undefined) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload.role === 'ADMIN' ? (payload.sub as string) : null;
  } catch {
    return null;
  }
}

// BigInt <-> JSON helpers for cache
function bigintReplacer(_: string, v: unknown) {
  return typeof v === 'bigint' ? { __bigint: v.toString() } : v;
}
function bigintReviver(_: string, v: any) {
  return v && typeof v === 'object' && '__bigint' in v ? BigInt(v.__bigint) : v;
}
