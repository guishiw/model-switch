import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHECK_TIMEOUT_MS = 3000;

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('health check timeout')), CHECK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

async function checkRedis(): Promise<boolean> {
  // The shared client is intentionally used so repeated LB probes cannot create
  // unbounded connection attempts while Redis/Sentinel is unavailable.
  if (redis.status === 'wait') await withTimeout(redis.connect());
  if (redis.status !== 'ready') return false;
  return (await withTimeout(redis.ping())) === 'PONG';
}

export async function GET() {
  const checks = await Promise.allSettled([
    withTimeout(prisma.$queryRawUnsafe('SELECT 1')),
    checkRedis(),
  ]);
  const database = checks[0].status === 'fulfilled';
  const redisReady = checks[1].status === 'fulfilled' && checks[1].value;
  const ready = database && redisReady;
  return NextResponse.json(
    { status: ready ? 'ready' : 'not_ready', checks: { database, redis: redisReady } },
    { status: ready ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
