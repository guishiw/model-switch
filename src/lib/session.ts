import { prisma } from './prisma';
import { Errors } from './errors';
import { countText } from './relay/tokens';
import type { ChatMessage } from './relay/types';
import type { MessageRole } from '@prisma/client';

/**
 * Session context management: prepend stored history to the incoming messages,
 * then persist the new user + assistant turns after completion.
 */
export async function buildSessionContext(sessionId: string, userId: string, incoming: ChatMessage[]): Promise<ChatMessage[]> {
  const session = await prisma.chatSession.findFirst({ where: { id: sessionId, userId } });
  if (!session) throw Errors.badRequest(`session '${sessionId}' not found`);

  const history = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
    take: session.contextWindow > 0 ? session.contextWindow : undefined,
  });
  history.reverse();

  const msgs: ChatMessage[] = [];
  if (session.systemPrompt) msgs.push({ role: 'system', content: session.systemPrompt });
  for (const h of history) msgs.push({ role: h.role, content: h.content });
  // incoming: keep only non-system (session owns the system prompt) — usually the latest user turn
  for (const m of incoming) if (m.role !== 'system' || !session.systemPrompt) msgs.push(m);
  return msgs;
}

export async function persistTurn(sessionId: string, userMessages: ChatMessage[], assistantText: string, requestLogId?: string) {
  const rows: Array<{ sessionId: string; role: MessageRole; content: string; tokenCount: number }> = userMessages
    .filter((m) => m.role === 'user')
    .map((m) => ({ sessionId, role: 'user', content: String(m.content ?? ''), tokenCount: countText(String(m.content ?? '')) }));
  rows.push({ sessionId, role: 'assistant', content: assistantText, tokenCount: countText(assistantText) });
  await prisma.$transaction([
    prisma.chatMessage.createMany({ data: rows.map((r) => ({ ...r, requestLogId })) }),
    prisma.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } }),
  ]);
}
