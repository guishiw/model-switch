import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateBearer } from '@/lib/auth';
import { RelayError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const CreateSchema = z.object({ model: z.string(), title: z.string().optional(), system_prompt: z.string().optional(), context_window: z.number().int().min(0).max(200).optional() });

/** POST /v1/sessions — create a conversation session; pass `session_id` in chat completions to auto-attach context */
export async function POST(req: NextRequest) {
  try {
    const ctx = await authenticateBearer(req);
    const p = CreateSchema.safeParse(await req.json().catch(() => null));
    if (!p.success) return NextResponse.json({ error: { message: p.error.message, type: 'invalid_request_error' } }, { status: 400 });
    const s = await prisma.chatSession.create({ data: { userId: ctx.user.id, model: p.data.model, title: p.data.title, systemPrompt: p.data.system_prompt, contextWindow: p.data.context_window ?? 20 } });
    return NextResponse.json({ id: s.id, model: s.model, title: s.title, created_at: s.createdAt });
  } catch (e) {
    if (e instanceof RelayError) return e.toResponse();
    throw e;
  }
}

/** GET /v1/sessions — list my sessions */
export async function GET(req: NextRequest) {
  try {
    const ctx = await authenticateBearer(req);
    const rows = await prisma.chatSession.findMany({ where: { userId: ctx.user.id }, orderBy: { updatedAt: 'desc' }, take: 100, include: { _count: { select: { messages: true } } } });
    return NextResponse.json({ data: rows.map((s) => ({ id: s.id, model: s.model, title: s.title, messages: s._count.messages, updated_at: s.updatedAt })) });
  } catch (e) {
    if (e instanceof RelayError) return e.toResponse();
    throw e;
  }
}
