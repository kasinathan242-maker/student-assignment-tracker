import { model, Schema } from 'mongoose';
import {
  LIMITS,
  NOTIFICATION_PREFERENCE_KEYS,
  PLATFORM_ROLES,
  USER_STATUSES,
  type NotificationPreferences,
  type PlatformRole,
  type UserStatus,
} from '@sat/shared';
import { baseOptions, ObjectId, type Id, type Timestamps } from './_common';

/* ───────────── users ───────────── */

export interface UserDoc extends Timestamps {
  _id: Id;
  email: string;
  name: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  status: UserStatus;
  platformRole: PlatformRole | null;
  timezone: string;
  locale: string;
  avatarFileId: Id | null;
  notificationPreferences: NotificationPreferences;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  passwordChangedAt: Date | null;
}

const prefChannel = Object.fromEntries(
  NOTIFICATION_PREFERENCE_KEYS.map((k) => [k, { type: Boolean, default: true }]),
);

export function defaultNotificationPreferences(): NotificationPreferences {
  const all = Object.fromEntries(
    NOTIFICATION_PREFERENCE_KEYS.map((k) => [k, true]),
  ) as NotificationPreferences['inApp'];
  return { inApp: { ...all }, email: { ...all }, reminderOffsetsMinutes: null };
}

const userSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: LIMITS.email },
    name: { type: String, required: true, trim: true, maxlength: LIMITS.name },
    passwordHash: { type: String, required: true, select: false },
    emailVerifiedAt: { type: Date, default: null },
    status: { type: String, enum: USER_STATUSES, default: 'active', required: true },
    platformRole: { type: String, enum: [...PLATFORM_ROLES, null], default: null },
    timezone: { type: String, default: 'UTC', maxlength: 64 },
    locale: { type: String, default: 'en', maxlength: 10 },
    avatarFileId: { type: ObjectId, default: null },
    notificationPreferences: {
      inApp: prefChannel,
      email: prefChannel,
      reminderOffsetsMinutes: { type: [Number], default: null },
    },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
  },
  baseOptions<UserDoc>('users'),
);
// Identity model: one global account per email address; organization access comes from memberships.
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ platformRole: 1 }, { partialFilterExpression: { platformRole: { $type: 'string' } } });

export const User = model<UserDoc>('User', userSchema);

/* ───────────── sessions (refresh-token families) ───────────── */

export interface SessionDoc extends Timestamps {
  _id: Id;
  userId: Id;
  refreshTokenHash: string;
  /** Hashes of rotated-out refresh tokens; presenting one indicates replay and revokes the session. */
  previousTokenHashes: string[];
  userAgent: string;
  ipPrefix: string;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
}

const sessionSchema = new Schema<SessionDoc>(
  {
    userId: { type: ObjectId, required: true, ref: 'User' },
    refreshTokenHash: { type: String, required: true },
    previousTokenHashes: { type: [String], default: [] },
    userAgent: { type: String, default: '', maxlength: 300 },
    ipPrefix: { type: String, default: '', maxlength: 64 },
    lastUsedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
  },
  baseOptions<SessionDoc>('refreshSessions'),
);
sessionSchema.index({ refreshTokenHash: 1 }, { unique: true });
sessionSchema.index({ previousTokenHashes: 1 });
sessionSchema.index({ userId: 1, revokedAt: 1 });
// Expired sessions are purged automatically 7 days after expiry.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });

export const Session = model<SessionDoc>('Session', sessionSchema);

/* ───────────── single-use email tokens ───────────── */

export const EMAIL_TOKEN_PURPOSES = ['verify_email', 'password_reset'] as const;
export type EmailTokenPurpose = (typeof EMAIL_TOKEN_PURPOSES)[number];

export interface EmailTokenDoc extends Timestamps {
  _id: Id;
  userId: Id;
  purpose: EmailTokenPurpose;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

const emailTokenSchema = new Schema<EmailTokenDoc>(
  {
    userId: { type: ObjectId, required: true },
    purpose: { type: String, enum: EMAIL_TOKEN_PURPOSES, required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  baseOptions<EmailTokenDoc>('emailTokens'),
);
emailTokenSchema.index({ tokenHash: 1 }, { unique: true });
emailTokenSchema.index({ userId: 1, purpose: 1 });
emailTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 3600 });

export const EmailToken = model<EmailTokenDoc>('EmailToken', emailTokenSchema);
