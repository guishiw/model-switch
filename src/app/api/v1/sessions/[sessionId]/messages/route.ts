import { NextRequest, NextResponse } from 'next/server';
import { authenticateBearer } from '@/lib/auth';
import { RelayError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/** GET /v1/sessions/:id/messages — conversation history */
export async function GET(req: NextRequest, { params }: { params: { sessionId: string } }) {
  try {
    const ctx = await authenticateBearer(req);
    const s = await prisma.chatSession.findFirst({ where: { id: params.sessionId, userId: ctx.user.id } });
    if (!s) return NextResponse.json({ error: { message: 'session not found', type: 'invalid_request_error' } }, { status: 404 });
    const messages = await prisma.chatMessage.findMany({ where: { sessionId: s.id }, orderBy: { createdAt: 'asc' } });
    return NextResponse.json({ session: { id: s.id, model: s.model, system_prompt: s.systemPrompt }, data: messages.map((m) => ({ id: m.id, role: m.role, content: m.content, tokens: m.tokenCount, created_at: m.createdAt })) });
  } catch (e) {
    if (e instanceof RelayError) return e.toResponse();
    throw e;
  }
}

/** DELETE /v1/sessions/:id/messages — clear context */
export async function DELETE(req: NextRequest, { params }: { params: { sessionId: string } }) {
  try {
    const ctx = await authenticateBearer(req);
    const r = await prisma.chatMessage.deleteMany({ where: { sessionId: params.sessionId, session: { userId: ctx.user.id } } });
    return NextResponse.json({ deleted: r.count });
  } catch (e) {
    if (e instanceof RelayError) return e.toResponse();
    throw e;
  }
}
