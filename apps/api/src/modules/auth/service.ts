import type { Request, Response } from 'express';
import type { ClientSession } from 'mongoose';
import type { LoginPortal, MeDTO, OrgRole } from '@sat/shared';
import { env } from '../../config/env';
import { isDuplicateKeyError, withTransaction } from '../../db/connection';
import { hashToken, randomToken } from '../../lib/crypto';
import { errors } from '../../lib/errors';
import { logger, maskEmail } from '../../lib/logger';
import { ipPrefix } from '../../lib/request';
import {
  Course,
  EmailToken,
  Enrollment,
  Invitation,
  LoginAttempt,
  Membership,
  Organization,
  User,
  defaultNotificationPreferences,
  type EmailTokenPurpose,
  type Id,
  type InvitationDoc,
  type MembershipDoc,
  type OrganizationDoc,
  type UserDoc,
} from '../../models';
import { audit } from '../../services/audit';
import { queueEmail } from '../../services/notifications';
import { hashPassword, verifyDummyPassword, verifyPassword } from '../../services/passwords';
import { revokeAllSessions, startSession } from '../../services/sessions';
import { serializeUser } from '../me/serializers';

const VERIFY_TTL_MS = 24 * 3600_000;
const RESET_TTL_MS = 30 * 60_000;
export const INVITATION_TTL_MS = 7 * 24 * 3600_000;

const ROLE_RANK: Record<OrgRole, number> = { student: 0, teacher: 1, org_admin: 2 };

const PORTAL_LABEL: Record<LoginPortal, string> = {
  student: 'Student',
  teacher: 'Teacher',
  admin: 'HOD / Admin',
};

/** The sign-in pages an account may use, from its active memberships in active organizations. */
async function allowedPortals(user: Pick<UserDoc, '_id' | 'platformRole'>): Promise<LoginPortal[]> {
  const memberships = await Membership.find({ userId: user._id, status: 'active' })
    .select({ orgId: 1, role: 1 })
    .lean<Pick<MembershipDoc, 'orgId' | 'role'>[]>();
  const activeOrgs = new Set(
    (
      await Organization.find({ _id: { $in: memberships.map((m) => m.orgId) }, status: 'active' })
        .select({ _id: 1 })
        .lean<Pick<OrganizationDoc, '_id'>[]>()
    ).map((o) => o._id.toString()),
  );
  const roles = new Set(memberships.filter((m) => activeOrgs.has(m.orgId.toString())).map((m) => m.role));
  const portals: LoginPortal[] = [];
  // An account that has not joined an organization yet signs in as a student, then joins with a code.
  if (roles.has('student') || (roles.size === 0 && user.platformRole !== 'platform_admin'))
    portals.push('student');
  if (roles.has('teacher')) portals.push('teacher');
  if (roles.has('org_admin') || user.platformRole === 'platform_admin') portals.push('admin');
  return portals;
}

export async function buildMe(userId: string, csrfToken: string): Promise<MeDTO> {
  const user = await User.findById(userId).lean<UserDoc>();
  if (!user) throw errors.unauthenticated();
  const memberships = await Membership.find({
    userId,
    status: { $in: ['active', 'pending', 'suspended'] },
  }).lean<MembershipDoc[]>();
  const orgs = await Organization.find({ _id: { $in: memberships.map((m) => m.orgId) } }).lean<
    OrganizationDoc[]
  >();
  const orgById = new Map(orgs.map((o) => [o._id.toString(), o]));
  return {
    user: serializeUser(user),
    memberships: memberships
      .map((m) => {
        const org = orgById.get(m.orgId.toString());
        if (!org) return null;
        return {
          id: m._id.toString(),
          orgId: org._id.toString(),
          orgName: org.name,
          orgSlug: org.slug,
          orgStatus: org.status,
          orgTimezone: org.timezone,
          role: m.role,
          status: m.status,
          studentNumber: m.studentNumber,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .sort((a, b) => a.orgName.localeCompare(b.orgName)),
    csrfToken,
  };
}

async function issueEmailToken(
  userId: Id,
  purpose: EmailTokenPurpose,
  ttlMs: number,
  session?: ClientSession,
): Promise<string> {
  const token = randomToken();
  // Only the newest token of a purpose is valid.
  await EmailToken.deleteMany({ userId, purpose, usedAt: null }, { session });
  await EmailToken.create(
    [{ userId, purpose, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) }],
    { session },
  );
  return token;
}

async function redeemEmailToken(token: string, purpose: EmailTokenPurpose, session: ClientSession) {
  const now = new Date();
  const record = await EmailToken.findOneAndUpdate(
    { tokenHash: hashToken(token), purpose, usedAt: null, expiresAt: { $gt: now } },
    { $set: { usedAt: now } },
    { returnDocument: 'after', session },
  );
  if (!record) {
    throw errors.validation(
      'This link is invalid or has expired. Request a new one.',
      undefined,
      'invalid_token',
    );
  }
  return record;
}

export async function findPendingInvitation(token: string): Promise<InvitationDoc> {
  const inv = await Invitation.findOne({ tokenHash: hashToken(token) }).lean<InvitationDoc>();
  if (!inv || inv.status !== 'pending') {
    throw errors.validation(
      'This invitation is invalid or has already been used.',
      undefined,
      'invalid_invitation',
    );
  }
  if (inv.expiresAt.getTime() <= Date.now()) {
    await Invitation.updateOne({ _id: inv._id, status: 'pending' }, { $set: { status: 'expired' } });
    throw errors.validation(
      'This invitation has expired. Ask your administrator to send a new one.',
      undefined,
      'invitation_expired',
    );
  }
  return inv;
}

/**
 * Applies an invitation to a user inside a transaction. Roles are never downgraded and suspended
 * memberships are not reactivated by an invitation (that requires an administrator).
 */
export async function applyInvitation(
  inv: InvitationDoc,
  userId: Id,
  session: ClientSession,
): Promise<MembershipDoc> {
  const org = await Organization.findById(inv.orgId).session(session).lean<OrganizationDoc>();
  if (!org || org.status !== 'active')
    throw errors.validation('This organization is not accepting members.', undefined, 'org_unavailable');

  const claimed = await Invitation.updateOne(
    { _id: inv._id, status: 'pending' },
    { $set: { status: 'accepted', acceptedBy: userId, acceptedAt: new Date() } },
    { session },
  );
  if (claimed.modifiedCount !== 1)
    throw errors.conflict('This invitation has already been used.', 'invitation_used');

  const now = new Date();
  let membership = await Membership.findOne({ orgId: inv.orgId, userId }).session(session);
  if (membership) {
    if (membership.status === 'suspended') {
      throw errors.forbidden(
        'Your membership in this organization is suspended. Contact an administrator.',
        'membership_suspended',
      );
    }
    if (membership.status !== 'active') {
      membership.status = 'active';
      membership.role = inv.role;
      membership.joinedAt = now;
    } else if (ROLE_RANK[inv.role] > ROLE_RANK[membership.role]) {
      membership.role = inv.role;
    }
    membership.invitedBy = inv.invitedBy;
    await membership.save({ session });
  } else {
    const [created] = await Membership.create(
      [
        {
          orgId: inv.orgId,
          userId,
          role: inv.role,
          status: 'active',
          joinedAt: now,
          invitedBy: inv.invitedBy,
        },
      ],
      { session },
    );
    if (!created) throw new Error('membership creation failed');
    membership = created;
  }

  if (inv.courseId) {
    const course = await Course.findOne({ _id: inv.courseId, orgId: inv.orgId, status: 'active' }).session(
      session,
    );
    if (course) {
      const role = inv.role === 'student' ? 'student' : 'instructor';
      await Enrollment.updateOne(
        { courseId: course._id, userId },
        {
          $set: { status: 'active', role, droppedAt: null },
          $setOnInsert: { orgId: inv.orgId, courseId: course._id, userId, enrolledAt: now, sectionId: null },
        },
        { upsert: true, session },
      );
    }
  }
  await audit({
    action: 'invitation.accepted',
    orgId: inv.orgId,
    actorId: userId,
    targetType: 'invitation',
    targetId: inv._id,
    metadata: { role: inv.role, courseId: inv.courseId },
    session,
  });
  return membership.toObject() as MembershipDoc;
}

export interface RegisterResult {
  /** account_ready: verification is off; the same answer is given whether or not the email was new. */
  status: 'signed_in' | 'verification_sent' | 'account_ready';
  me?: MeDTO;
}

/**
 * Registration never reveals whether an email already has an account: public sign-up always answers
 * "check your email". Invitation-based sign-up proves inbox ownership via the token and signs in directly.
 */
export async function register(
  req: Request,
  res: Response,
  input: { name: string; email: string; password: string; invitationToken?: string; timezone?: string },
): Promise<RegisterResult> {
  const passwordHash = await hashPassword(input.password);

  if (input.invitationToken) {
    const inv = await findPendingInvitation(input.invitationToken);
    if (inv.email !== input.email) {
      throw errors.validation(
        'This invitation was sent to a different email address.',
        { email: ['Use the invited email address.'] },
        'invitation_email_mismatch',
      );
    }
    if (await User.exists({ email: input.email })) {
      throw errors.conflict(
        'An account already exists for this email. Sign in to accept the invitation.',
        'account_exists',
      );
    }
    const userId = await withTransaction(async (session) => {
      const [user] = await User.create(
        [
          {
            email: input.email,
            name: input.name,
            passwordHash,
            emailVerifiedAt: new Date(),
            timezone: input.timezone ?? 'UTC',
            notificationPreferences: defaultNotificationPreferences(),
          },
        ],
        { session },
      );
      if (!user) throw new Error('user creation failed');
      await applyInvitation(inv, user._id, session);
      return user._id;
    });
    await audit({
      req,
      action: 'auth.registered',
      actorId: userId,
      targetType: 'user',
      targetId: userId,
      metadata: { via: 'invitation' },
    });
    const { csrfToken } = await startSession(req, res, userId);
    await User.updateOne({ _id: userId }, { $set: { lastLoginAt: new Date() } });
    return { status: 'signed_in', me: await buildMe(userId.toString(), csrfToken) };
  }

  const requireVerification = env().REQUIRE_EMAIL_VERIFICATION;
  const existing = await User.findOne({ email: input.email }).lean<UserDoc>();
  // Without verification nobody proves inbox ownership, so an existing account is never overwritten.
  if (existing?.emailVerifiedAt || (existing && !requireVerification)) {
    await queueEmail(existing.email, 'account_exists', {});
  } else if (existing) {
    // Unverified: whoever controls the inbox wins — refresh credentials and resend verification.
    await User.updateOne({ _id: existing._id }, { $set: { name: input.name, passwordHash } });
    const token = await issueEmailToken(existing._id, 'verify_email', VERIFY_TTL_MS);
    await queueEmail(existing.email, 'verify_email', { name: input.name, token });
  } else {
    try {
      const user = await User.create({
        email: input.email,
        name: input.name,
        passwordHash,
        timezone: input.timezone ?? 'UTC',
        notificationPreferences: defaultNotificationPreferences(),
      });
      if (requireVerification) {
        const token = await issueEmailToken(user._id, 'verify_email', VERIFY_TTL_MS);
        await queueEmail(user.email, 'verify_email', { name: user.name, token });
      }
      await audit({
        req,
        action: 'auth.registered',
        actorId: user._id,
        targetType: 'user',
        targetId: user._id,
        metadata: { via: 'public' },
      });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err; // concurrent duplicate registration: same generic answer
    }
  }
  logger().info({ email: maskEmail(input.email) }, 'registration requested');
  return { status: requireVerification ? 'verification_sent' : 'account_ready' };
}

export async function login(
  req: Request,
  res: Response,
  email: string,
  password: string,
  portal?: LoginPortal,
): Promise<MeDTO> {
  const config = env();
  const user = await User.findOne({ email }).select('+passwordHash');
  const record = (success: boolean) =>
    LoginAttempt.create({
      emailHash: hashToken(email).slice(0, 32),
      ipPrefix: ipPrefix(req.ip),
      success,
    }).catch(() => undefined);

  if (!user) {
    await verifyDummyPassword(password);
    await record(false);
    throw errors.unauthenticated('Incorrect email or password.', 'invalid_credentials');
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await record(false);
    throw errors.rateLimited('Too many sign-in attempts. Wait a few minutes or reset your password.');
  }
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= config.LOGIN_LOCKOUT_THRESHOLD;
    await User.updateOne(
      { _id: user._id },
      lock
        ? {
            $set: {
              failedLoginCount: 0,
              lockedUntil: new Date(Date.now() + config.LOGIN_LOCKOUT_MINUTES * 60_000),
            },
          }
        : { $inc: { failedLoginCount: 1 } },
    );
    await record(false);
    await audit({
      req,
      action: lock ? 'auth.account.locked' : 'auth.login.failed',
      actorId: user._id,
      targetType: 'user',
      targetId: user._id,
    });
    throw errors.unauthenticated('Incorrect email or password.', 'invalid_credentials');
  }
  // Status checks happen only after the password is proven, so they reveal nothing to an attacker.
  if (user.status !== 'active')
    throw errors.forbidden('This account is not active. Contact your administrator.', 'account_inactive');
  if (config.REQUIRE_EMAIL_VERIFICATION && !user.emailVerifiedAt) {
    throw errors.forbidden(
      'Confirm your email address before signing in. Check your inbox for the link.',
      'email_not_verified',
    );
  }
  // Each sign-in page admits only its own role. Checked after the password, so it reveals nothing to a guesser.
  if (portal) {
    const portals = await allowedPortals(user);
    if (!portals.includes(portal)) {
      const use =
        portals.length > 0 ? ` Use the ${portals.map((p) => PORTAL_LABEL[p]).join(' or ')} login.` : '';
      throw errors.forbidden(
        `This account cannot use the ${PORTAL_LABEL[portal]} login.${use}`,
        'wrong_portal',
      );
    }
  }
  await User.updateOne(
    { _id: user._id },
    { $set: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } },
  );
  await record(true);
  const { csrfToken } = await startSession(req, res, user._id);
  await audit({ req, action: 'auth.login', actorId: user._id, targetType: 'user', targetId: user._id });
  return buildMe(user._id.toString(), csrfToken);
}

/**
 * Email verification requires the account password as well as the emailed token. Otherwise an attacker
 * could register someone else's address with a password of their choosing and wait for the real owner
 * to click the link ("pre-account takeover"). The password is checked before the token is consumed.
 */
export async function verifyEmail(req: Request, token: string, password: string): Promise<void> {
  const pending = await EmailToken.findOne({
    tokenHash: hashToken(token),
    purpose: 'verify_email',
    usedAt: null,
    expiresAt: { $gt: new Date() },
  }).lean();
  if (!pending) {
    throw errors.validation(
      'This link is invalid or has expired. Request a new one.',
      undefined,
      'invalid_token',
    );
  }
  const owner = await User.findById(pending.userId).select('+passwordHash');
  if (!owner || !(await verifyPassword(owner.passwordHash, password))) {
    throw errors.validation(
      'That password does not match this account. If you did not create it, ignore the link or reset the password.',
      { password: ['Incorrect password'] },
      'invalid_password',
    );
  }
  const userId = await withTransaction(async (session) => {
    const record = await redeemEmailToken(token, 'verify_email', session);
    await User.updateOne(
      { _id: record.userId, emailVerifiedAt: null },
      { $set: { emailVerifiedAt: new Date() } },
      { session },
    );
    return record.userId;
  });
  await audit({ req, action: 'auth.email.verified', actorId: userId, targetType: 'user', targetId: userId });
}

export async function resendVerification(email: string): Promise<void> {
  const user = await User.findOne({ email, emailVerifiedAt: null, status: 'active' }).lean<UserDoc>();
  if (!user) return;
  const token = await issueEmailToken(user._id, 'verify_email', VERIFY_TTL_MS);
  await queueEmail(user.email, 'verify_email', { name: user.name, token });
}

export async function requestPasswordReset(req: Request, email: string): Promise<void> {
  const user = await User.findOne({ email, status: 'active' }).lean<UserDoc>();
  if (!user) return;
  const token = await issueEmailToken(user._id, 'password_reset', RESET_TTL_MS);
  await queueEmail(user.email, 'password_reset', { token });
  await audit({
    req,
    action: 'auth.password.reset_requested',
    actorId: user._id,
    targetType: 'user',
    targetId: user._id,
  });
}

export async function resetPassword(req: Request, token: string, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  const user = await withTransaction(async (session) => {
    const record = await redeemEmailToken(token, 'password_reset', session);
    const now = new Date();
    const updated = await User.findOneAndUpdate(
      { _id: record.userId, status: 'active' },
      // Completing a reset proves inbox ownership, so it also verifies the address and clears lockout.
      { $set: { passwordHash, passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null } },
      { returnDocument: 'after', session },
    ).lean<UserDoc>();
    if (!updated)
      throw errors.validation(
        'This link is invalid or has expired. Request a new one.',
        undefined,
        'invalid_token',
      );
    await User.updateOne(
      { _id: record.userId, emailVerifiedAt: null },
      { $set: { emailVerifiedAt: now } },
      { session },
    );
    await EmailToken.deleteMany({ userId: record.userId, purpose: 'password_reset' }, { session });
    return updated;
  });
  await revokeAllSessions(user._id, 'password_reset');
  await queueEmail(user.email, 'password_changed', {});
  await audit({
    req,
    action: 'auth.password.reset',
    actorId: user._id,
    targetType: 'user',
    targetId: user._id,
  });
}

export async function changePassword(
  req: Request,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const auth = req.auth;
  if (!auth) throw errors.unauthenticated();
  const user = await User.findById(auth.userId).select('+passwordHash');
  if (!user || !(await verifyPassword(user.passwordHash, currentPassword))) {
    throw errors.validation(
      'Your current password is incorrect.',
      { currentPassword: ['Incorrect password.'] },
      'invalid_password',
    );
  }
  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  await user.save();
  const revoked = await revokeAllSessions(user._id, 'password_changed', auth.sessionId);
  await queueEmail(user.email, 'password_changed', {});
  await audit({
    req,
    action: 'auth.password.changed',
    targetType: 'user',
    targetId: user._id,
    metadata: { otherSessionsRevoked: revoked },
  });
}
