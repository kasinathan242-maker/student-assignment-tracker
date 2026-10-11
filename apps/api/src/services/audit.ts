import type { ClientSession } from 'mongoose';
import type { Request } from 'express';
import { logger } from '../lib/logger';
import { ipPrefix } from '../lib/request';
import { AuditLog, type Id } from '../models';

const SENSITIVE_KEY = /pass(word)?|token|secret|hash|cookie|authorization|otp|code$/i;
const DEFAULT_RETENTION_DAYS = 730;

/** Removes secrets and bounds size so audit metadata can never leak credentials or grow unbounded. */
export function sanitizeMetadata(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && 'toHexString' in (value as object)) return String(value);
  if (depth > 3) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitizeMetadata(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : sanitizeMetadata(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

export interface AuditInput {
  req?: Request;
  action: string;
  orgId?: Id | string | null;
  actorId?: Id | string | null;
  targetType?: string;
  targetId?: Id | string | null;
  metadata?: Record<string, unknown>;
  session?: ClientSession;
}

/**
 * Writes an audit record. Audit failures are logged but never abort the user's operation unless the
 * caller passes a transaction session (then the write is part of the atomic unit).
 */
export async function audit(input: AuditInput): Promise<void> {
  const orgId = input.orgId ?? input.req?.org?.orgId ?? null;
  const retentionDays = input.req?.org?.org.settings.auditRetentionDays ?? DEFAULT_RETENTION_DAYS;
  const doc = {
    orgId,
    actorId: input.actorId ?? input.req?.auth?.userId ?? null,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ? String(input.targetId) : null,
    metadata: (sanitizeMetadata(input.metadata ?? {}) as Record<string, unknown>) ?? {},
    ip: input.req ? ipPrefix(input.req.ip) : null,
    requestId: input.req ? String(input.req.id) : null,
    expiresAt: new Date(Date.now() + retentionDays * 86_400_000),
  };
  if (input.session) {
    await AuditLog.create([doc], { session: input.session });
    return;
  }
  try {
    await AuditLog.create(doc);
  } catch (err) {
    logger().error({ err, action: input.action }, 'failed to write audit log');
  }
}
