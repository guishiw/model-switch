import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
const PAGE_SIZE = 20;

/** GET /api/admin/logs?page=1&status=&model=&channel= — paginated request log (20 per page) */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const page = Math.max(1, Number(q.get('page') ?? 1));
  const where = {
    ...(q.get('status') ? { status: q.get('status') as any } : {}),
    ...(q.get('model') ? { publicModel: { contains: q.get('model')! } } : {}),
    ...(q.get('channel') ? { channelId: q.get('channel')! } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.requestLog.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE,
      select: {
        id: true, requestId: true, status: true, httpStatus: true, publicModel: true, upstreamModel: true, stream: true,
        promptTokens: true, completionTokens: true, latencyMs: true, queueWaitMs: true, ttfbMs: true, retries: true,
        clientIp: true, errorMessage: true, createdAt: true, updatedAt: true,
        channel: { select: { name: true } }, token: { select: { name: true } },
      },
    }),
    prisma.requestLog.count({ where }),
  ]);
  return NextResponse.json({ rows, total, page, pageSize: PAGE_SIZE, serverTime: Date.now() });
}
