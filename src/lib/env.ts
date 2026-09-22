import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://localhost:6379/0'),
  /** Comma-separated host:port list. When set, Redis Sentinel is used instead of REDIS_URL. */
  REDIS_SENTINELS: z.string().optional(),
  REDIS_SENTINEL_MASTER_NAME: z.string().default('mymaster'),
  REDIS_SENTINEL_USERNAME: z.string().optional(),
  REDIS_SENTINEL_PASSWORD: z.string().optional(),
  REDIS_USERNAME: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().min(0).default(0),
  ADMIN_JWT_SECRET: z.string().min(32),
  API_KEY_ENCRYPTION_KEY: z.string().optional(),

  GLOBAL_MAX_CONCURRENCY: z.coerce.number().int().positive().default(50),
  QUEUE_MAX_WAIT_SECONDS: z.coerce.number().int().positive().default(60),
  QUEUE_PROGRESS_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  ASYNC_JOB_ATTEMPTS: z.coerce.number().int().min(1).default(3),
  ASYNC_JOB_BACKOFF_MS: z.coerce.number().int().positive().default(5000),

  /** Max wait for the first byte of the upstream response (headers + first chunk) */
  UPSTREAM_TTFB_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  /** Max total duration of one upstream call, incl. the whole stream */
  UPSTREAM_TOTAL_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  RELAY_MAX_RETRIES: z.coerce.number().int().min(0).default(2),
  CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
  CIRCUIT_OPEN_SECONDS: z.coerce.number().int().positive().default(60),

  AUDIT_BANNED_WORDS: z.string().default(''),
  AUDIT_PROVIDER: z.enum(['local', 'none']).default('local'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment variables');
}

export const env = parsed.data;
