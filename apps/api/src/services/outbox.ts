import { hostname } from 'node:os';
import type { ClientSession } from 'mongoose';
import { isDuplicateKeyError } from '../db/connection';
import { logger } from '../lib/logger';
import { OutboxEvent, type OutboxEventDoc } from '../models';

/**
 * Transactional outbox. Primary actions (submission, grade publication, …) write their outbox event in the
 * SAME MongoDB transaction as the state change, so a committed action can never lose its follow-up work
 * and a rolled-back action never emits it. A worker then delivers events at-least-once with exponential
 * backoff; every handler is idempotent (notifications carry unique dedupe keys).
 */

export type OutboxHandler = (payload: Record<string, unknown>, event: OutboxEventDoc) => Promise<void>;

const handlers = new Map<string, OutboxHandler>();
/** Event types whose payload contains sealed secrets; the payload is scrubbed once delivered. */
const SENSITIVE_TYPES = new Set<string>();

export function registerOutboxHandler(
  type: string,
  handler: OutboxHandler,
  opts: { sensitive?: boolean } = {},
): void {
  handlers.set(type, handler);
  if (opts.sensitive) SENSITIVE_TYPES.add(type);
}

export interface EnqueueOptions {
  session?: ClientSession;
  dedupeKey?: string;
  delayMs?: number;
  maxAttempts?: number;
}

export async function enqueue(
  type: string,
  payload: Record<string, unknown>,
  opts: EnqueueOptions = {},
): Promise<void> {
  const doc = {
    type,
    payload,
    status: 'pending' as const,
    availableAt: new Date(Date.now() + (opts.delayMs ?? 0)),
    dedupeKey: opts.dedupeKey ?? null,
    maxAttempts: opts.maxAttempts ?? 8,
  };
  try {
    if (opts.session) await OutboxEvent.create([doc], { session: opts.session });
    else await OutboxEvent.create(doc);
  } catch (err) {
    // A duplicate dedupeKey means this exact event was already recorded — that is success.
    if (!isDuplicateKeyError(err)) throw err;
  }
}

const WORKER_ID = `${hostname()}:${process.pid}`;
const LOCK_MS = 60_000;

/** Exponential backoff with full jitter: ~5s, 10s, 20s … capped at 30 minutes. */
export function backoffMs(attempt: number): number {
  const base = Math.min(30 * 60_000, 5_000 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base / 2 + Math.random() * (base / 2));
}

async function claim(): Promise<OutboxEventDoc | null> {
  const now = new Date();
  return OutboxEvent.findOneAndUpdate(
    {
      $or: [
        { status: 'pending', availableAt: { $lte: now } },
        // Reclaim events whose worker crashed mid-processing.
        { status: 'processing', lockedUntil: { $lt: now } },
      ],
    },
    {
      $set: { status: 'processing', lockedUntil: new Date(now.getTime() + LOCK_MS), lockedBy: WORKER_ID },
      $inc: { attempts: 1 },
    },
    { sort: { availableAt: 1 }, returnDocument: 'after' },
  ).lean<OutboxEventDoc>();
}

async function processOne(event: OutboxEventDoc): Promise<void> {
  const handler = handlers.get(event.type);
  try {
    if (!handler) throw new Error(`No handler registered for outbox event "${event.type}"`);
    await handler(event.payload, event);
    await OutboxEvent.updateOne(
      { _id: event._id, lockedBy: WORKER_ID },
      {
        $set: {
          status: 'done',
          completedAt: new Date(),
          lockedUntil: null,
          lastError: null,
          ...(SENSITIVE_TYPES.has(event.type) ? { payload: { scrubbed: true } } : {}),
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : String(err);
    const dead = event.attempts >= event.maxAttempts;
    logger()[dead ? 'error' : 'warn'](
      { eventId: event._id.toString(), type: event.type, attempts: event.attempts, err: message },
      dead ? 'outbox event dead-lettered' : 'outbox event failed; will retry',
    );
    await OutboxEvent.updateOne(
      { _id: event._id, lockedBy: WORKER_ID },
      {
        $set: {
          status: dead ? 'dead' : 'pending',
          availableAt: new Date(Date.now() + backoffMs(event.attempts)),
          lockedUntil: null,
          lastError: message,
        },
      },
    );
  }
}

/** Drains up to `max` ready events. Returns the number processed. */
export async function drainOutbox(max = 100): Promise<number> {
  let processed = 0;
  while (processed < max) {
    const event = await claim();
    if (!event) break;
    await processOne(event);
    processed += 1;
  }
  return processed;
}

export async function outboxBacklog(): Promise<{
  pending: number;
  dead: number;
  oldestPendingSeconds: number | null;
}> {
  const [pending, dead, oldest] = await Promise.all([
    OutboxEvent.countDocuments({ status: { $in: ['pending', 'processing'] } }),
    OutboxEvent.countDocuments({ status: 'dead' }),
    OutboxEvent.findOne({ status: 'pending' })
      .sort({ availableAt: 1 })
      .select({ availableAt: 1 })
      .lean<{ availableAt: Date }>(),
  ]);
  return {
    pending,
    dead,
    oldestPendingSeconds: oldest
      ? Math.max(0, Math.round((Date.now() - oldest.availableAt.getTime()) / 1000))
      : null,
  };
}
