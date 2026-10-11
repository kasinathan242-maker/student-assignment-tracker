import { Router } from 'express';
import type { HealthDTO } from '@sat/shared';
import { env } from '../../config/env';
import { isDatabaseReady, pingDatabase } from '../../db/connection';
import { route } from '../../lib/route';
import { redisClient } from '../../middleware/rateLimit';
import { WorkerHeartbeat } from '../../models';
import { outboxBacklog } from '../../services/outbox';
import { storage } from '../../services/storage';

const startedAt = Date.now();
type Check = HealthDTO['checks'][string];

/** Detailed dependency status. Never includes hosts, credentials or connection strings. */
export async function detailedHealth(): Promise<HealthDTO> {
  const checks: Record<string, Check> = {};
  checks.database = (await pingDatabase()) ? { status: 'ok' } : { status: 'unavailable' };
  checks.storage = (await storage().healthCheck()) ? { status: 'ok' } : { status: 'unavailable' };
  const redis = redisClient();
  checks.redis = !redis
    ? { status: 'disabled' }
    : redis.status === 'ready'
      ? { status: 'ok' }
      : { status: 'degraded', detail: 'rate limits fall back to per-instance' };
  if (checks.database.status === 'ok') {
    const beat = await WorkerHeartbeat.findOne().sort({ lastBeatAt: -1 }).lean();
    const age = beat ? (Date.now() - beat.lastBeatAt.getTime()) / 1000 : null;
    checks.worker =
      age != null && age < 120
        ? { status: 'ok' }
        : {
            status: 'degraded',
            detail: age == null ? 'no heartbeat recorded' : `last heartbeat ${Math.round(age)}s ago`,
          };
    const backlog = await outboxBacklog();
    checks.outbox =
      backlog.dead > 0 || (backlog.oldestPendingSeconds ?? 0) > 600
        ? { status: 'degraded', detail: `${backlog.pending} pending, ${backlog.dead} dead-lettered` }
        : { status: 'ok', detail: `${backlog.pending} pending` };
  }
  const statuses = Object.values(checks).map((c) => c.status);
  const status =
    checks.database.status !== 'ok' || checks.storage.status !== 'ok'
      ? 'unavailable'
      : statuses.includes('degraded')
        ? 'degraded'
        : 'ok';
  return {
    status,
    checks,
    version: env().APP_VERSION,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
}

export function healthRoutes(): Router {
  const r = Router();
  const tags = ['Health'];

  route(r, {
    method: 'get',
    path: '/health/live',
    summary: 'Liveness: the process is running (does not check dependencies)',
    tags,
    access: 'public',
    handler: () => ({ status: 'ok' }),
  });

  route(r, {
    method: 'get',
    path: '/health/ready',
    summary: 'Readiness: required dependencies (database, storage) are reachable',
    tags,
    access: 'public',
    handler: async ({ res }) => {
      const dbOk = isDatabaseReady() && (await pingDatabase());
      const storageOk = await storage().healthCheck();
      const ready = dbOk && storageOk;
      res.status(ready ? 200 : 503);
      return {
        status: ready ? 'ok' : 'unavailable',
        checks: { database: dbOk ? 'ok' : 'unavailable', storage: storageOk ? 'ok' : 'unavailable' },
      };
    },
  });

  return r;
}
