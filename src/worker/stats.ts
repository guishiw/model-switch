import type { PrismaClient } from '@prisma/client';

/** Roll up the current and previous hour of RequestLog into UsageStatHourly (idempotent upsert). */
export async function rollupHour(prisma: PrismaClient) {
  const now = new Date();
  const thisHour = new Date(now); thisHour.setMinutes(0, 0, 0);
  const prevHour = new Date(thisHour.getTime() - 3600_000);

  for (const bucket of [prevHour, thisHour]) {
    const end = new Date(bucket.getTime() + 3600_000);
    const rows = await prisma.$queryRaw<Array<{
      channelId: string | null; tokenId: string | null; publicModel: string; requests: bigint; successes: bigint;
      promptTokens: bigint; completionTokens: bigint; cost: number; p50: number; p95: number;
    }>>`
      SELECT "channelId", "tokenId", "publicModel",
             COUNT(*)                                             AS requests,
             COUNT(*) FILTER (WHERE status = 'SUCCESS')           AS successes,
             COALESCE(SUM("promptTokens"), 0)                     AS "promptTokens",
             COALESCE(SUM("completionTokens"), 0)                 AS "completionTokens",
             COALESCE(SUM(cost), 0)::float                        AS cost,
             COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs"), 0)::int  AS p50,
             COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs"), 0)::int AS p95
      FROM "RequestLog"
      WHERE "createdAt" >= ${bucket} AND "createdAt" < ${end}
      GROUP BY "channelId", "tokenId", "publicModel"`;

    for (const r of rows) {
      const data = {
        requests: Number(r.requests), successes: Number(r.successes), promptTokens: r.promptTokens, completionTokens: r.completionTokens,
        cost: r.cost, latencyP50: r.p50, latencyP95: r.p95,
      };
      // composite unique with nullable columns: use deleteMany+create for portability
      await prisma.$transaction([
        prisma.usageStatHourly.deleteMany({ where: { bucket, channelId: r.channelId, tokenId: r.tokenId, publicModel: r.publicModel } }),
        prisma.usageStatHourly.create({ data: { bucket, channelId: r.channelId, tokenId: r.tokenId, publicModel: r.publicModel, ...data } }),
      ]);
    }
  }
}
