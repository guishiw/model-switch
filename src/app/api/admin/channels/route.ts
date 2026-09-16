import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { encrypt } from '@/lib/crypto';
import { invalidateRouteCache } from '@/lib/relay/selector';
import { inflightCounts } from '@/lib/queue/channel-concurrency';

const ChannelSchema = z.object({
  name: z.string().min(1),
  provider: z.enum(['OPENAI', 'ANTHROPIC', 'GEMINI', 'OLLAMA']),
  baseUrl: z.string().url(),
  weight: z.number().int().min(1).default(10),
  priority: z.number().int().default(0),
  maxConcurrency: z.number().int().min(0).default(0),
  rpmLimit: z.number().int().min(0).default(0),
  tpmLimit: z.number().int().min(0).default(0),
  extraHeaders: z.record(z.string()).optional(),
  config: z.record(z.any()).optional(),
  /** raw keys; encrypted at rest */
  keys: z.array(z.string().min(1)).default([]),
  mappings: z.array(z.object({ publicModel: z.string().min(1), upstreamModel: z.string().min(1), paramTemplateId: z.string().optional(), maxConcurrency: z.number().int().min(0).optional(), inputPricePerM: z.number().optional(), outputPricePerM: z.number().optional() })).default([]),
});

const publicChannel = (c: any) => ({ ...c, keys: c.keys?.map((k: any) => ({ id: k.id, hint: k.hint, enabled: k.enabled, disabledReason: k.disabledReason, weight: k.weight, lastUsedAt: k.lastUsedAt })) });

/** Channels with live in-flight counts (channel + per model) */
export async function GET() {
  const rows = await prisma.channel.findMany({ include: { keys: true, modelMappings: { include: { paramTemplate: true } } }, orderBy: { createdAt: 'desc' } });
  const inflight = await inflightCounts(rows.map((r) => ({ id: r.id, models: r.modelMappings.map((m) => m.publicModel) })));
  return NextResponse.json(rows.map((r) => ({ ...publicChannel(r), inflight: inflight[r.id] })));
}

export async function POST(req: NextRequest) {
  const p = ChannelSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.flatten() }, { status: 400 });
  const { keys, mappings, ...data } = p.data;
  const ch = await prisma.channel.create({
    data: {
      ...data,
      keys: { create: keys.map((k) => ({ encryptedKey: encrypt(k), hint: k.slice(-4) })) },
      modelMappings: { create: mappings },
    },
    include: { keys: true, modelMappings: true },
  });
  await Promise.all(mappings.map((m) => invalidateRouteCache(m.publicModel)));
  return NextResponse.json(publicChannel(ch), { status: 201 });
}
