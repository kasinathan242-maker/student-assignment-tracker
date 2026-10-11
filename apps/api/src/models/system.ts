import { model, Schema } from 'mongoose';
import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_STATUSES,
  LIMITS,
  NOTIFICATION_TYPES,
  type AnnouncementAudience,
  type AnnouncementStatus,
  type NotificationType,
} from '@sat/shared';
import { baseOptions, ObjectId, type Id, type Timestamps } from './_common';

/* ───────────── notifications ───────────── */

export interface NotificationDoc {
  _id: Id;
  orgId: Id | null;
  userId: Id;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  refType: string | null;
  refId: Id | null;
  /** Idempotency key: a retried job or duplicate event cannot create a second notification. */
  dedupeKey: string;
  readAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

const notificationSchema = new Schema<NotificationDoc>(
  {
    orgId: { type: ObjectId, default: null },
    userId: { type: ObjectId, required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, default: '', maxlength: 1000 },
    link: { type: String, default: null, maxlength: 500 },
    refType: { type: String, default: null },
    refId: { type: ObjectId, default: null },
    dedupeKey: { type: String, required: true, maxlength: 300 },
    readAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  baseOptions<NotificationDoc>('notifications', { timestamps: { createdAt: true, updatedAt: false } }),
);
notificationSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true });
notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, orgId: 1, createdAt: -1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Notification = model<NotificationDoc>('Notification', notificationSchema);

/* ───────────── announcements ───────────── */

export interface AnnouncementDoc extends Timestamps {
  _id: Id;
  orgId: Id;
  courseId: Id | null;
  authorId: Id;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  status: AnnouncementStatus;
  publishAt: Date | null;
  publishedAt: Date | null;
  expiresAt: Date | null;
  sendEmail: boolean;
  requireAck: boolean;
  history: { at: Date; actorId: Id; fields: string[] }[];
  rev: number;
}

const announcementSchema = new Schema<AnnouncementDoc>(
  {
    orgId: { type: ObjectId, required: true },
    courseId: { type: ObjectId, default: null },
    authorId: { type: ObjectId, required: true },
    title: { type: String, required: true, maxlength: LIMITS.announcementTitle },
    body: { type: String, required: true, maxlength: LIMITS.announcementBody },
    audience: { type: String, enum: ANNOUNCEMENT_AUDIENCES, required: true },
    status: { type: String, enum: ANNOUNCEMENT_STATUSES, default: 'draft' },
    publishAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    sendEmail: { type: Boolean, default: false },
    requireAck: { type: Boolean, default: false },
    history: {
      type: [{ _id: false, at: Date, actorId: ObjectId, fields: [String] }],
      default: [],
    },
    rev: { type: Number, default: 0 },
  },
  baseOptions<AnnouncementDoc>('announcementRecords'),
);
announcementSchema.index({ orgId: 1, status: 1, courseId: 1, publishedAt: -1 });
announcementSchema.index({ status: 1, publishAt: 1 }, { partialFilterExpression: { status: 'scheduled' } });

export const Announcement = model<AnnouncementDoc>('Announcement', announcementSchema);

export interface AnnouncementReceiptDoc {
  _id: Id;
  announcementId: Id;
  userId: Id;
  readAt: Date | null;
  acknowledgedAt: Date | null;
}

const receiptSchema = new Schema<AnnouncementReceiptDoc>(
  {
    announcementId: { type: ObjectId, required: true },
    userId: { type: ObjectId, required: true },
    readAt: { type: Date, default: null },
    acknowledgedAt: { type: Date, default: null },
  },
  { collection: 'announcementReceipts', versionKey: false },
);
receiptSchema.index({ announcementId: 1, userId: 1 }, { unique: true });
receiptSchema.index({ userId: 1 });

export const AnnouncementReceipt = model<AnnouncementReceiptDoc>('AnnouncementReceipt', receiptSchema);

/* ───────────── audit log ───────────── */

export interface AuditLogDoc {
  _id: Id;
  orgId: Id | null;
  actorId: Id | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  requestId: string | null;
  createdAt: Date;
  expiresAt: Date;
}

const auditSchema = new Schema<AuditLogDoc>(
  {
    orgId: { type: ObjectId, default: null },
    actorId: { type: ObjectId, default: null },
    action: { type: String, required: true, maxlength: 80 },
    targetType: { type: String, default: null },
    targetId: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ip: { type: String, default: null },
    requestId: { type: String, default: null },
    expiresAt: { type: Date, required: true },
  },
  baseOptions<AuditLogDoc>('auditLogs', { timestamps: { createdAt: true, updatedAt: false } }),
);
auditSchema.index({ orgId: 1, createdAt: -1 });
auditSchema.index({ orgId: 1, actorId: 1, createdAt: -1 });
auditSchema.index({ orgId: 1, action: 1, createdAt: -1 });
auditSchema.index({ action: 1, createdAt: -1 });
auditSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuditLog = model<AuditLogDoc>('AuditLog', auditSchema);

/* ───────────── idempotency records ───────────── */

export interface IdempotencyDoc {
  _id: Id;
  userId: Id;
  key: string;
  scope: string;
  requestHash: string;
  state: 'in_progress' | 'completed';
  statusCode: number | null;
  responseBody: unknown;
  createdAt: Date;
  expiresAt: Date;
}

const idempotencySchema = new Schema<IdempotencyDoc>(
  {
    userId: { type: ObjectId, required: true },
    key: { type: String, required: true, maxlength: LIMITS.idempotencyKey },
    scope: { type: String, required: true },
    requestHash: { type: String, required: true },
    state: { type: String, enum: ['in_progress', 'completed'], required: true },
    statusCode: { type: Number, default: null },
    responseBody: { type: Schema.Types.Mixed, default: null },
    expiresAt: { type: Date, required: true },
  },
  baseOptions<IdempotencyDoc>('idempotencyRecords', { timestamps: { createdAt: true, updatedAt: false } }),
);
idempotencySchema.index({ userId: 1, scope: 1, key: 1 }, { unique: true });
idempotencySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const IdempotencyRecord = model<IdempotencyDoc>('IdempotencyRecord', idempotencySchema);

/* ───────────── transactional outbox ───────────── */

export type OutboxStatus = 'pending' | 'processing' | 'done' | 'dead';

export interface OutboxEventDoc {
  _id: Id;
  type: string;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  lockedUntil: Date | null;
  lockedBy: string | null;
  lastError: string | null;
  dedupeKey: string | null;
  completedAt: Date | null;
  createdAt: Date;
}

const outboxSchema = new Schema<OutboxEventDoc>(
  {
    type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    status: { type: String, enum: ['pending', 'processing', 'done', 'dead'], default: 'pending' },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 8 },
    availableAt: { type: Date, required: true },
    lockedUntil: { type: Date, default: null },
    lockedBy: { type: String, default: null },
    lastError: { type: String, default: null },
    dedupeKey: { type: String, default: null },
    completedAt: { type: Date, default: null },
  },
  baseOptions<OutboxEventDoc>('outboxEvents', { timestamps: { createdAt: true, updatedAt: false } }),
);
outboxSchema.index({ status: 1, availableAt: 1 });
outboxSchema.index({ status: 1, lockedUntil: 1 }, { partialFilterExpression: { status: 'processing' } });
outboxSchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
);
// Completed events are kept for 14 days for diagnosis, then purged.
outboxSchema.index({ completedAt: 1 }, { expireAfterSeconds: 14 * 24 * 3600 });

export const OutboxEvent = model<OutboxEventDoc>('OutboxEvent', outboxSchema);

/* ───────────── worker heartbeats (health reporting) ───────────── */

export interface WorkerHeartbeatDoc {
  _id: string;
  lastBeatAt: Date;
  jobs: Record<string, { lastRunAt: Date | null; lastError: string | null }>;
}

const heartbeatSchema = new Schema<WorkerHeartbeatDoc>(
  {
    _id: { type: String, required: true },
    lastBeatAt: { type: Date, required: true },
    jobs: { type: Schema.Types.Mixed, default: {} },
  },
  { collection: 'workerHeartbeats', versionKey: false },
);

export const WorkerHeartbeat = model<WorkerHeartbeatDoc>('WorkerHeartbeat', heartbeatSchema);

/* ───────────── rate-limit buckets used for security analytics ───────────── */

export interface LoginAttemptDoc {
  _id: Id;
  emailHash: string;
  ipPrefix: string;
  success: boolean;
  createdAt: Date;
}

const loginAttemptSchema = new Schema<LoginAttemptDoc>(
  {
    emailHash: { type: String, required: true },
    ipPrefix: { type: String, default: '' },
    success: { type: Boolean, required: true },
  },
  baseOptions<LoginAttemptDoc>('loginAttempts', { timestamps: { createdAt: true, updatedAt: false } }),
);
loginAttemptSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });
loginAttemptSchema.index({ success: 1, createdAt: -1 });

export const LoginAttempt = model<LoginAttemptDoc>('LoginAttempt', loginAttemptSchema);
