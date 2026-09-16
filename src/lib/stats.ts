import type { PrismaClient } from '@prisma/client';

export async function getDashboardStats(prisma: PrismaClient) {
  const since24h = new Date(Date.now() - 24 * 3600_000);

  const [totals, byStatus, hourly, byModel, latency, channels] = await Promise.all([
    prisma.requestLog.aggregate({ where: { createdAt: { gte: since24h } }, _count: true, _sum: { totalTokens: true, cost: true }, _avg: { latencyMs: true } }),
    prisma.requestLog.groupBy({ by: ['status'], where: { createdAt: { gte: since24h } }, _count: true }),
    prisma.$queryRaw<Array<{ hour: Date; requests: bigint; tokens: bigint; failures: bigint }>>`
      SELECT date_trunc('hour', "createdAt") AS hour, COUNT(*) AS requests, COALESCE(SUM("totalTokens"),0) AS tokens,
             COUNT(*) FILTER (WHERE status <> 'SUCCESS') AS failures
      FROM "RequestLog" WHERE "createdAt" >= ${since24h} GROUP BY 1 ORDER BY 1`,
    prisma.requestLog.groupBy({ by: ['publicModel'], where: { createdAt: { gte: since24h } }, _count: true, _sum: { totalTokens: true, cost: true }, orderBy: { _count: { publicModel: 'desc' } }, take: 10 }),
    prisma.$queryRaw<Array<{ p50: number; p90: number; p99: number }>>`
      SELECT COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs"),0)::int AS p50,
             COALESCE(percentile_cont(0.9) WITHIN GROUP (ORDER BY "latencyMs"),0)::int AS p90,
             COALESCE(percentile_cont(0.99) WITHIN GROUP (ORDER BY "latencyMs"),0)::int AS p99
      FROM "RequestLog" WHERE "createdAt" >= ${since24h} AND status = 'SUCCESS'`,
    prisma.channel.findMany({ select: { id: true, name: true, status: true, provider: true, _count: { select: { keys: true } } } }),
  ]);

  const total = totals._count;
  const success = byStatus.find((s) => s.status === 'SUCCESS')?._count ?? 0;

  return {
    summary: {
      requests24h: total,
      successRate: total ? +((success / total) * 100).toFixed(2) : 100,
      tokens24h: totals._sum.totalTokens ?? 0,
      cost24h: Number(totals._sum.cost ?? 0),
      avgLatencyMs: Math.round(totals._avg.latencyMs ?? 0),
      latency: latency[0] ?? { p50: 0, p90: 0, p99: 0 },
    },
    byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
    hourly: hourly.map((h) => ({ hour: h.hour, requests: Number(h.requests), tokens: Number(h.tokens), failures: Number(h.failures) })),
    byModel: byModel.map((m) => ({ model: m.publicModel, requests: m._count, tokens: m._sum.totalTokens ?? 0, cost: Number(m._sum.cost ?? 0) })),
    channels,
  };
}
