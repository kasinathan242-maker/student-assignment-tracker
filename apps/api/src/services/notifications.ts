import type { ClientSession } from 'mongoose';
import { NOTIFICATION_TYPE_CATEGORY, type NotificationType } from '@sat/shared';
import { seal } from '../lib/seal';
import { Notification, Organization, User, type Id, type UserDoc } from '../models';
import { renderEmail, type EmailTemplate } from './email/templates';
import { enqueue } from './outbox';

export interface DeliverInput {
  orgId: Id | string | null;
  userIds: (Id | string)[];
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  refType?: string;
  refId?: Id | string | null;
  /** Combined with the user id to form the per-recipient idempotency key. */
  dedupeKey: string;
  /** Also send email to recipients who allow email for this category. */
  email?: boolean;
}

const DEFAULT_RETENTION_DAYS = 180;

/**
 * Persists in-app notifications (respecting per-user preferences) and queues emails. Idempotent: the
 * unique (userId, dedupeKey) index makes retries and duplicate events harmless, and emails are only
 * queued for notifications that were newly inserted.
 */
export async function deliver(input: DeliverInput): Promise<number> {
  if (input.userIds.length === 0) return 0;
  const category = NOTIFICATION_TYPE_CATEGORY[input.type];
  const users = await User.find({ _id: { $in: input.userIds }, status: 'active' })
    .select({ email: 1, name: 1, notificationPreferences: 1 })
    .lean<Pick<UserDoc, '_id' | 'email' | 'name' | 'notificationPreferences'>[]>();
  const org = input.orgId ? await Organization.findById(input.orgId).select({ settings: 1 }).lean() : null;
  const retentionDays = org?.settings?.notificationRetentionDays ?? DEFAULT_RETENTION_DAYS;
  const expiresAt = new Date(Date.now() + retentionDays * 86_400_000);

  const allowed = (u: (typeof users)[number], channel: 'inApp' | 'email') =>
    category === 'security' || u.notificationPreferences?.[channel]?.[category] !== false;

  const inApp = users.filter((u) => allowed(u, 'inApp'));
  const inserted = new Set<string>();
  if (inApp.length > 0) {
    const ops = inApp.map((u) => ({
      updateOne: {
        filter: { userId: u._id, dedupeKey: input.dedupeKey },
        update: {
          $setOnInsert: {
            orgId: input.orgId,
            userId: u._id,
            type: input.type,
            title: input.title.slice(0, 200),
            body: input.body.slice(0, 1000),
            link: input.link,
            refType: input.refType ?? null,
            refId: input.refId ?? null,
            dedupeKey: input.dedupeKey,
            readAt: null,
            expiresAt,
            createdAt: new Date(),
          },
        },
        upsert: true,
      },
    }));
    try {
      const result = await Notification.bulkWrite(ops, { ordered: false });
      for (const index of Object.keys(result.upsertedIds)) {
        const user = inApp[Number(index)];
        if (user) inserted.add(user._id.toString());
      }
    } catch (err) {
      // A concurrent duplicate delivery can race on the unique index; the other writer owns that row.
      const e = err as { code?: number; result?: { upsertedIds?: Record<string, unknown> } };
      if (e.code !== 11000) throw err;
      for (const index of Object.keys(e.result?.upsertedIds ?? {})) {
        const user = inApp[Number(index)];
        if (user) inserted.add(user._id.toString());
      }
    }
  }

  if (input.email) {
    for (const u of users) {
      // Email recipients: preference allows email AND (in-app record was new OR in-app is disabled).
      if (!allowed(u, 'email')) continue;
      if (allowed(u, 'inApp') && !inserted.has(u._id.toString())) continue;
      await queueEmail(
        u.email,
        'notification',
        { title: input.title, body: input.body, link: input.link ?? '' },
        {
          dedupeKey: `email:${u._id.toString()}:${input.dedupeKey}`,
        },
      );
    }
  }
  return inserted.size;
}

/**
 * Queues an email through the outbox. Variables are sealed (encrypted) because some contain one-time
 * tokens; the worker decrypts at send time and scrubs the payload afterwards.
 */
export async function queueEmail(
  to: string,
  template: EmailTemplate,
  vars: Record<string, string>,
  opts: { dedupeKey?: string; session?: ClientSession } = {},
): Promise<void> {
  // Render eagerly to fail fast on template errors; only the sealed variables are persisted.
  renderEmail(template, vars);
  await enqueue('email.send', { to: seal(to), template, vars: seal(JSON.stringify(vars)) }, opts);
}
