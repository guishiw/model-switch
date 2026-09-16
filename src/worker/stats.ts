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
      SELECT channelId, tokenId, publicModel,
             COUNT(*)                                                  AS requests,
             SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END)       AS successes,
             COALESCE(SUM(promptTokens), 0)                            AS promptTokens,
             COALESCE(SUM(completionTokens), 0)                        AS completionTokens,
             COALESCE(SUM(cost), 0)                                    AS cost,
             COALESCE(MAX(CASE WHEN rn = CEIL(cnt * 0.5)  THEN latencyMs END), 0) AS p50,
             COALESCE(MAX(CASE WHEN rn = CEIL(cnt * 0.95) THEN latencyMs END), 0) AS p95
      FROM (
        SELECT channelId, tokenId, publicModel, status, promptTokens, completionTokens, cost, latencyMs,
               ROW_NUMBER() OVER (PARTITION BY channelId, tokenId, publicModel ORDER BY latencyMs) AS rn,
               COUNT(*)     OVER (PARTITION BY channelId, tokenId, publicModel)                    AS cnt
        FROM RequestLog
        WHERE createdAt >= ${bucket} AND createdAt < ${end}
      ) t
      GROUP BY channelId, tokenId, publicModel`;

    for (const r of rows) {
      const data = {
        requests: Number(r.requests), successes: Number(r.successes), promptTokens: BigInt(r.promptTokens), completionTokens: BigInt(r.completionTokens),
        cost: Number(r.cost), latencyP50: Number(r.p50), latencyP95: Number(r.p95),
      };
      // composite unique with nullable columns: use deleteMany+create for portability
      await prisma.$transaction([
        prisma.usageStatHourly.deleteMany({ where: { bucket, channelId: r.channelId, tokenId: r.tokenId, publicModel: r.publicModel } }),
        prisma.usageStatHourly.create({ data: { bucket, channelId: r.channelId, tokenId: r.tokenId, publicModel: r.publicModel, ...data } }),
      ]);
    }
  }
}
