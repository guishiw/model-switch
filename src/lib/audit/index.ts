import { env } from '../env';
import { prisma } from '../prisma';
import { logger } from '../logger';

export type AuditResult = { blocked: boolean; matched: string[] };

/**
 * Content audit. `local` = banned-word list from env (+ DB extension point).
 * Swap `externalCheck` for a vendor API (Aliyun Green, Baidu, OpenAI Moderation ...) as needed.
 */
const banned = env.AUDIT_BANNED_WORDS.split(',').map((s) => s.trim()).filter(Boolean);
const pattern = banned.length ? new RegExp(banned.map(escape).join('|'), 'i') : null;

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function auditText(text: string): Promise<AuditResult> {
  if (env.AUDIT_PROVIDER === 'none' || !pattern) return { blocked: false, matched: [] };
  const matched = new Set<string>();
  for (const m of text.matchAll(new RegExp(pattern.source, 'gi'))) matched.add(m[0].toLowerCase());
  return { blocked: matched.size > 0, matched: [...matched] };
}

export async function recordAuditHit(requestId: string, direction: 'input' | 'output', matched: string[], snippet: string) {
  try {
    await prisma.auditHit.create({ data: { requestId, direction, matched, snippet: snippet.slice(0, 500) } });
  } catch (err) {
    logger.error({ err }, 'failed to record audit hit');
  }
}

/**
 * Streaming output filter: buffers a small tail so banned words split across chunks are caught.
 * Returns a transform that either passes text through or throws when blocked.
 */
export function createStreamAuditor(maxWordLen = 32) {
  let tail = '';
  return {
    async check(delta: string): Promise<AuditResult> {
      const window = tail + delta;
      const r = await auditText(window);
      tail = window.slice(-maxWordLen);
      return r;
    },
  };
}
