import type { NextRequest } from 'next/server';

export function clientIp(req: NextRequest) {
  return (req.headers.get('x-forwarded-for')?.split(',')[0] ?? req.headers.get('x-real-ip') ?? req.ip ?? '').trim() || undefined;
}

export const sseHeaders = (extra: Record<string, string> = {}) => ({
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
  ...extra,
});

export const encoder = new TextEncoder();
export const sseData = (obj: unknown) => encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);
export const sseEvent = (event: string, obj: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(obj)}\n\n`);
export const sseComment = (text: string) => encoder.encode(`: ${text}\n\n`);
