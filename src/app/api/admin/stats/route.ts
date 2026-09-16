import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { queueSnapshot } from '@/lib/queue/concurrency';
import { getDashboardStats } from '@/lib/stats';

export const dynamic = 'force-dynamic';

/** Live metrics for the dashboard (polled every few seconds) */
export async function GET() {
  const [queue, stats] = await Promise.all([queueSnapshot(), getDashboardStats(prisma)]);
  return NextResponse.json({ queue, ...stats });
}
