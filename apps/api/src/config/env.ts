import { z } from 'zod';

/**
 * Environment configuration, validated once at startup. In production every secret is required and
 * startup fails with a precise message; in development/test, documented non-secret defaults are used so
 * the app runs without cloud credentials (see .env.example and docs/configuration.md).
 */

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v == null ? fallback : v === 'true' || v === '1'));

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const DEV_ONLY_SECRET = 'dev-only-insecure-secret-change-me-0123456789abcdef';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    APP_URL: z.url().default('http://localhost:5173'),
    CORS_ORIGINS: csv,
    TRUST_PROXY: z.string().default('loopback'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),

    MONGO_URI: z.string().min(1).optional(),
    MONGO_AUTO_INDEX: bool(true),

    JWT_ACCESS_SECRET: z.string().min(32).optional(),
    CSRF_SECRET: z.string().min(32).optional(),
    ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    COOKIE_SECURE: bool(false),
    LOGIN_LOCKOUT_THRESHOLD: z.coerce.number().int().min(3).max(100).default(10),
    LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

    REDIS_URL: z.string().optional(),
    RATE_LIMIT_ENABLED: bool(true),

    EMAIL_PROVIDER: z.enum(['smtp', 'file', 'memory']).default('file'),
    EMAIL_FROM: z.string().default('Assignment Tracker <no-reply@localhost>'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_SECURE: bool(false),
    DEV_MAILBOX_DIR: z.string().default('.data/mail'),

    STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
    LOCAL_STORAGE_DIR: z.string().default('.data/uploads'),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_ENDPOINT: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool(false),
    /** Create the bucket on first use (local/dev stacks only; production buckets are provisioned). */
    S3_CREATE_BUCKET: bool(false),
    /** Server-side encryption header for uploads; "none" for gateways that do not support it. */
    S3_SSE: z.enum(['AES256', 'aws:kms', 'none']).default('AES256'),

    MALWARE_SCANNER: z.enum(['none', 'clamav']).default('none'),
    CLAMAV_HOST: z.string().default('127.0.0.1'),
    CLAMAV_PORT: z.coerce.number().int().default(3310),
    /** When true, files must have a clean scan result before anyone can download them. */
    REQUIRE_CLEAN_SCAN: bool(false),

    RUN_WORKER_INLINE: bool(true),
    WORKER_POLL_MS: z.coerce.number().int().min(250).max(60_000).default(5_000),
    /** Interval for time-based jobs (scheduled publication, auto-close, reminders). */
    SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),

    ERROR_REPORTER: z.enum(['log', 'webhook']).default('log'),
    ERROR_WEBHOOK_URL: z.url().optional(),

    DEV_MAILBOX_ENABLED: bool(false),
    /**
     * When true, new accounts must confirm their email address before signing in or using a join code.
     * Off by default for a single-machine install where email is not delivered to real inboxes.
     */
    REQUIRE_EMAIL_VERIFICATION: bool(false),
    /** Built web app (apps/web/dist) to serve from the API on the same origin; unset in development (Vite serves it). */
    WEB_DIST_DIR: z.string().optional(),
    APP_VERSION: z.string().default('1.0.0'),
  })
  .superRefine((env, ctx) => {
    const require = (key: keyof typeof env, why: string) => {
      if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `required ${why}` });
    };
    require('MONGO_URI', 'in all environments (run `npm run db:local` for a local database)');
    if (env.NODE_ENV === 'production') {
      require('JWT_ACCESS_SECRET', 'in production (min 32 chars)');
      require('CSRF_SECRET', 'in production (min 32 chars)');
      if (env.JWT_ACCESS_SECRET && env.JWT_ACCESS_SECRET === env.CSRF_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['CSRF_SECRET'],
          message: 'must differ from JWT_ACCESS_SECRET',
        });
      }
      if (!env.COOKIE_SECURE) {
        ctx.addIssue({
          code: 'custom',
          path: ['COOKIE_SECURE'],
          message: 'must be true in production (HTTPS only)',
        });
      }
      if (env.EMAIL_PROVIDER !== 'smtp') {
        ctx.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'must be "smtp" in production' });
      }
      if (env.DEV_MAILBOX_ENABLED) {
        ctx.addIssue({
          code: 'custom',
          path: ['DEV_MAILBOX_ENABLED'],
          message: 'must be false in production',
        });
      }
    }
    if (env.EMAIL_PROVIDER === 'smtp') require('SMTP_HOST', 'when EMAIL_PROVIDER=smtp');
    if (env.STORAGE_PROVIDER === 's3') {
      require('S3_BUCKET', 'when STORAGE_PROVIDER=s3');
      require('S3_REGION', 'when STORAGE_PROVIDER=s3');
    }
    if (env.ERROR_REPORTER === 'webhook') require('ERROR_WEBHOOK_URL', 'when ERROR_REPORTER=webhook');
  });

export type Env = z.infer<typeof schema> & {
  MONGO_URI: string;
  JWT_ACCESS_SECRET: string;
  CSRF_SECRET: string;
  corsOrigins: string[];
  isProduction: boolean;
  isTest: boolean;
};

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // `KEY=` in an env file means "not set", not "set to an empty string".
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ''),
  );
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const details = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  const env = result.data;
  return {
    ...env,
    MONGO_URI: env.MONGO_URI as string,
    // Non-production fallbacks are deliberately conspicuous and never used when NODE_ENV=production.
    JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRET ?? `${DEV_ONLY_SECRET}-jwt`,
    CSRF_SECRET: env.CSRF_SECRET ?? `${DEV_ONLY_SECRET}-csrf`,
    corsOrigins: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : [env.APP_URL],
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
  };
}

let cached: Env | null = null;

export function env(): Env {
  cached ??= parseEnv();
  return cached;
}

/** Test hook: replace configuration (e.g. per-suite overrides). */
export function setEnv(next: Env): void {
  cached = next;
}
