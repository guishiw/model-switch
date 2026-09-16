import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/** GET /api/admin/logs/:id — full request log incl. request/response bodies and audit hits */
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const row = await prisma.requestLog.findUnique({
    where: { id: params.id },
    include: { channel: { select: { name: true, provider: true, baseUrl: true } }, token: { select: { name: true, user: { select: { username: true } } } } },
  });
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const audits = await prisma.auditHit.findMany({ where: { requestId: row.requestId }, orderBy: { createdAt: 'asc' } });
  return NextResponse.json({ ...row, cost: Number(row.cost), audits, serverTime: Date.now() });
}
