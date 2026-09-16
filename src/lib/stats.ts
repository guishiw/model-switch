import type { PrismaClient } from '@prisma/client';
import { inflightCounts } from './queue/channel-concurrency';

export async function getDashboardStats(prisma: PrismaClient) {
  const since24h = new Date(Date.now() - 24 * 3600_000);

  const [totals, byStatus, hourly, byModel, latency, channels] = await Promise.all([
    prisma.requestLog.aggregate({ where: { createdAt: { gte: since24h } }, _count: true, _sum: { totalTokens: true, cost: true }, _avg: { latencyMs: true } }),
    prisma.requestLog.groupBy({ by: ['status'], where: { createdAt: { gte: since24h } }, _count: true }),
    prisma.$queryRaw<Array<{ hour: Date; requests: bigint; tokens: bigint; failures: bigint }>>`
      SELECT DATE_FORMAT(createdAt, '%Y-%m-%d %H:00:00') AS hour, COUNT(*) AS requests, COALESCE(SUM(totalTokens),0) AS tokens,
             SUM(CASE WHEN status <> 'SUCCESS' THEN 1 ELSE 0 END) AS failures
      FROM RequestLog WHERE createdAt >= ${since24h} GROUP BY 1 ORDER BY 1`,
    prisma.requestLog.groupBy({ by: ['publicModel'], where: { createdAt: { gte: since24h } }, _count: true, _sum: { totalTokens: true, cost: true }, orderBy: { _count: { publicModel: 'desc' } }, take: 10 }),
    prisma.$queryRaw<Array<{ p50: number; p90: number; p99: number }>>`
      SELECT COALESCE(MAX(CASE WHEN rn = CEIL(cnt * 0.5)  THEN latencyMs END), 0) AS p50,
             COALESCE(MAX(CASE WHEN rn = CEIL(cnt * 0.9)  THEN latencyMs END), 0) AS p90,
             COALESCE(MAX(CASE WHEN rn = CEIL(cnt * 0.99) THEN latencyMs END), 0) AS p99
      FROM (SELECT latencyMs, ROW_NUMBER() OVER (ORDER BY latencyMs) AS rn, COUNT(*) OVER () AS cnt
            FROM RequestLog WHERE createdAt >= ${since24h} AND status = 'SUCCESS') t`,
    prisma.channel.findMany({ select: { id: true, name: true, status: true, provider: true, maxConcurrency: true, _count: { select: { keys: true } } } }),
  ]);

  const inflight = await inflightCounts(channels.map((c) => ({ id: c.id, models: [] })));
  const total = totals._count;
  const success = byStatus.find((s) => s.status === 'SUCCESS')?._count ?? 0;

  return {
    summary: {
      requests24h: total,
      successRate: total ? +((success / total) * 100).toFixed(2) : 100,
      tokens24h: totals._sum.totalTokens ?? 0,
      cost24h: Number(totals._sum.cost ?? 0),
      avgLatencyMs: Math.round(totals._avg.latencyMs ?? 0),
      latency: latency[0] ? { p50: Number(latency[0].p50), p90: Number(latency[0].p90), p99: Number(latency[0].p99) } : { p50: 0, p90: 0, p99: 0 },
    },
    byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
    hourly: hourly.map((h) => ({ hour: new Date(String(h.hour).replace(' ', 'T') + 'Z'), requests: Number(h.requests), tokens: Number(h.tokens), failures: Number(h.failures) })),
    byModel: byModel.map((m) => ({ model: m.publicModel, requests: m._count, tokens: m._sum.totalTokens ?? 0, cost: Number(m._sum.cost ?? 0) })),
    channels: channels.map((c) => ({ ...c, inflight: inflight[c.id]?.channel ?? 0 })),
  };
}
