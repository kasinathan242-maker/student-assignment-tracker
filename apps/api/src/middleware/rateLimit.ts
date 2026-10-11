import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit, type Store } from 'express-rate-limit';
import { Redis } from 'ioredis';
import { RedisStore } from 'rate-limit-redis';
import { env } from '../config/env';
import { hashToken } from '../lib/crypto';
import { errors } from '../lib/errors';
import { logger } from '../lib/logger';

/**
 * Rate limiting. With REDIS_URL set, counters are shared across API instances (required when running
 * more than one replica); otherwise an in-memory store is used, which is correct for a single process.
 */
let redis: Redis | null = null;

export function redisClient(): Redis | null {
  const url = env().REDIS_URL;
  if (!url) return null;
  if (!redis) {
    redis = new Redis(url, { maxRetriesPerRequest: 2, enableOfflineQueue: false, lazyConnect: false });
    redis.on('error', (err: Error) => logger().warn({ err: err.message }, 'redis error'));
  }
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (redis) await redis.quit().catch(() => undefined);
  redis = null;
}

function store(prefix: string): Store | undefined {
  const client = redisClient();
  if (!client) return undefined;
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (command: string, ...args: string[]) => client.call(command, ...args) as never,
  });
}

const ip = (req: Request) => ipKeyGenerator(req.ip ?? '0.0.0.0');

interface LimiterOptions {
  name: string;
  windowMinutes: number;
  limit: number;
  key?: (req: Request) => string;
  message?: string;
}

export function limiter(opts: LimiterOptions): RequestHandler {
  const handler = rateLimit({
    windowMs: opts.windowMinutes * 60_000,
    limit: opts.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    store: store(opts.name),
    // If Redis is unavailable, fail open for availability but log loudly; authentication lockout
    // (stored in MongoDB) still protects individual accounts.
    passOnStoreError: true,
    keyGenerator: opts.key ?? ip,
    skip: () => !env().RATE_LIMIT_ENABLED,
    handler: (_req, _res, next, options) =>
      next(errors.rateLimited(opts.message, Math.ceil(options.windowMs / 1000))),
  });
  return handler;
}

const emailKey = (req: Request) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  return `${ip(req)}:${hashToken(email).slice(0, 16)}`;
};
const userKey = (req: Request) => req.auth?.userId ?? ip(req);

export const limits = {
  login: () =>
    limiter({
      name: 'login',
      windowMinutes: 15,
      limit: 10,
      key: emailKey,
      message: 'Too many sign-in attempts. Wait a few minutes or reset your password.',
    }),
  loginIp: () => limiter({ name: 'login-ip', windowMinutes: 15, limit: 100 }),
  register: () => limiter({ name: 'register', windowMinutes: 60, limit: 10 }),
  passwordReset: () => limiter({ name: 'pwreset', windowMinutes: 60, limit: 5, key: emailKey }),
  tokenRedemption: () => limiter({ name: 'token', windowMinutes: 15, limit: 30 }),
  refresh: () => limiter({ name: 'refresh', windowMinutes: 5, limit: 60 }),
  upload: () =>
    limiter({
      name: 'upload',
      windowMinutes: 60,
      limit: 120,
      key: userKey,
      message: 'Upload limit reached. Try again later.',
    }),
  export: () => limiter({ name: 'export', windowMinutes: 60, limit: 30, key: userKey }),
  expensive: () => limiter({ name: 'expensive', windowMinutes: 1, limit: 60, key: userKey }),
  api: () => limiter({ name: 'api', windowMinutes: 15, limit: 3000, key: (req) => ip(req) }),
};
