import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { sha256 } from '@/lib/crypto';
import { invalidateTokenCache } from '@/lib/auth';

const CreateSchema = z.object({
  userId: z.string().optional(),
  name: z.string().min(1),
  rpmLimit: z.number().int().min(0).default(0),
  tpmLimit: z.number().int().min(0).default(0),
  tokenQuota: z.number().int().min(0).default(0),
  allowedModels: z.array(z.string()).default([]),
  expiresAt: z.string().datetime().optional(),
});

const serialize = (t: any) => ({ ...t, tokenQuota: Number(t.tokenQuota), tokensUsed: Number(t.tokensUsed) });

export async function GET() {
  const rows = await prisma.accessToken.findMany({ include: { user: { select: { username: true, tier: true } } }, orderBy: { createdAt: 'desc' } });
  return NextResponse.json(rows.map(serialize));
}

/** Creates a token; the raw value is returned exactly once. */
export async function POST(req: NextRequest) {
  const p = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.flatten() }, { status: 400 });
  const { userId, expiresAt, ...rest } = p.data;
  const owner = userId ?? (await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } })).id;
  const raw = 'sk-' + randomBytes(24).toString('hex');
  const t = await prisma.accessToken.create({ data: { ...rest, userId: owner, tokenHash: sha256(raw), hint: raw.slice(-4), expiresAt: expiresAt ? new Date(expiresAt) : undefined } });
  return NextResponse.json({ ...serialize(t), token: raw }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const { id, ...data } = await req.json();
  const t = await prisma.accessToken.update({ where: { id }, data: { enabled: data.enabled, rpmLimit: data.rpmLimit, tpmLimit: data.tpmLimit, tokenQuota: data.tokenQuota, allowedModels: data.allowedModels } });
  await invalidateTokenCache(t.tokenHash);
  return NextResponse.json(serialize(t));
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  const t = await prisma.accessToken.delete({ where: { id } });
  await invalidateTokenCache(t.tokenHash);
  return NextResponse.json({ ok: true });
}
