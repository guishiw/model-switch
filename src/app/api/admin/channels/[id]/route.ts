import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { encrypt } from '@/lib/crypto';
import { invalidateRouteCache } from '@/lib/relay/selector';
import { redis } from '@/lib/redis';

const PatchSchema = z.object({
  name: z.string().optional(),
  baseUrl: z.string().url().optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  weight: z.number().int().min(1).optional(),
  priority: z.number().int().optional(),
  rpmLimit: z.number().int().min(0).optional(),
  tpmLimit: z.number().int().min(0).optional(),
  maxConcurrency: z.number().int().min(0).optional(),
  /** Update concurrency limits of existing mappings in place (no re-create) */
  mappingLimits: z.array(z.object({ publicModel: z.string(), maxConcurrency: z.number().int().min(0) })).optional(),
  extraHeaders: z.record(z.string()).optional(),
  config: z.record(z.any()).optional(),
  addKeys: z.array(z.string().min(1)).optional(),
  removeKeyIds: z.array(z.string()).optional(),
  enableKeyIds: z.array(z.string()).optional(),
  mappings: z.array(z.object({ publicModel: z.string(), upstreamModel: z.string(), paramTemplateId: z.string().nullable().optional(), enabled: z.boolean().optional(), maxConcurrency: z.number().int().min(0).optional(), inputPricePerM: z.number().optional(), outputPricePerM: z.number().optional() })).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const p = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.flatten() }, { status: 400 });
  const { addKeys, removeKeyIds, enableKeyIds, mappings, mappingLimits, ...data } = p.data;

  const ch = await prisma.$transaction(async (tx) => {
    const c = await tx.channel.update({ where: { id: params.id }, data });
    if (addKeys?.length) await tx.apiKey.createMany({ data: addKeys.map((k) => ({ channelId: c.id, encryptedKey: encrypt(k), hint: k.slice(-4) })) });
    if (removeKeyIds?.length) await tx.apiKey.deleteMany({ where: { id: { in: removeKeyIds }, channelId: c.id } });
    if (enableKeyIds?.length) await tx.apiKey.updateMany({ where: { id: { in: enableKeyIds }, channelId: c.id }, data: { enabled: true, disabledReason: null, failureCount: 0 } });
    if (mappings) {
      await tx.modelMapping.deleteMany({ where: { channelId: c.id } });
      await tx.modelMapping.createMany({ data: mappings.map((m) => ({ ...m, channelId: c.id })) });
    }
    for (const m of mappingLimits ?? []) {
      await tx.modelMapping.updateMany({ where: { channelId: c.id, publicModel: m.publicModel }, data: { maxConcurrency: m.maxConcurrency } });
    }
    return tx.channel.findUniqueOrThrow({ where: { id: c.id }, include: { keys: true, modelMappings: true } });
  });

  if (data.status === 'ACTIVE') await redis.del(`gw:cb:${ch.id}`); // manual reset of circuit breaker
  await invalidateRouteCache();
  return NextResponse.json({ ...ch, keys: ch.keys.map(({ encryptedKey, ...k }) => k) });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  await prisma.channel.delete({ where: { id: params.id } });
  await invalidateRouteCache();
  return NextResponse.json({ ok: true });
}
