import { NextResponse } from 'next/server';

/** OpenAI-compatible error envelope */
export class RelayError extends Error {
  constructor(
    public status: number,
    message: string,
    public type: string = 'relay_error',
    public code?: string,
    public headers: Record<string, string> = {},
  ) {
    super(message);
  }

  toResponse() {
    return NextResponse.json(
      { error: { message: this.message, type: this.type, code: this.code ?? null } },
      { status: this.status, headers: this.headers },
    );
  }
}

export const Errors = {
  unauthorized: (msg = 'Invalid or missing API key') =>
    new RelayError(401, msg, 'authentication_error', 'invalid_api_key'),
  forbidden: (msg: string) => new RelayError(403, msg, 'permission_error', 'forbidden'),
  badRequest: (msg: string) => new RelayError(400, msg, 'invalid_request_error', 'bad_request'),
  rateLimited: (msg: string, retryAfterSec: number) =>
    new RelayError(429, msg, 'rate_limit_error', 'rate_limit_exceeded', {
      'Retry-After': String(Math.max(1, Math.ceil(retryAfterSec))),
    }),
  quotaExceeded: () => new RelayError(429, 'Token quota exceeded', 'insufficient_quota', 'insufficient_quota'),
  queueTimeout: (retryAfterSec: number) =>
    new RelayError(503, 'Gateway is busy, queue wait timed out. Please retry later.', 'server_error', 'queue_timeout', {
      'Retry-After': String(retryAfterSec),
    }),
  noChannel: (model: string) =>
    new RelayError(404, `No available channel for model '${model}'`, 'invalid_request_error', 'model_not_found'),
  audit: (words: string[]) =>
    new RelayError(400, `Content blocked by policy: ${words.join(', ')}`, 'content_policy_violation', 'content_filter'),
  upstream: (status: number, msg: string) => new RelayError(status >= 500 ? 502 : status, msg, 'upstream_error', 'upstream'),
};
