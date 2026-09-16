import { prisma } from './prisma';
import { logger } from './logger';

/**
 * Request lifecycle in the log table:
 *   QUEUED (created synchronously on arrival) -> RUNNING (slot acquired) -> terminal status (via the `logs` queue).
 * The first two writes are done inline so the admin log shows the request immediately.
 */
export async function createPendingLog(d: { requestId: string; tokenId?: string; publicModel: string; stream: boolean; clientIp?: string; userAgent?: string; requestBody: unknown }) {
  try {
    await prisma.requestLog.create({
      data: { requestId: d.requestId, tokenId: d.tokenId, publicModel: d.publicModel, stream: d.stream, status: 'QUEUED', httpStatus: 0, clientIp: d.clientIp, userAgent: d.userAgent, requestBody: d.requestBody as any },
    });
  } catch (err) {
    logger.error({ err, requestId: d.requestId }, 'failed to create pending log');
  }
}

export function markRunning(requestId: string, queueWaitMs: number) {
  prisma.requestLog
    .updateMany({ where: { requestId, status: 'QUEUED' }, data: { status: 'RUNNING', queueWaitMs } })
    .catch((err) => logger.error({ err, requestId }, 'failed to mark running'));
}
