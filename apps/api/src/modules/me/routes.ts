import { Router } from 'express';
import {
  AVATAR_MIME_TYPES,
  LIMITS,
  changePasswordSchema,
  joinOrganizationSchema,
  notificationPreferencesSchema,
  tokenSchema,
  updateProfileSchema,
  type InvitationDTO,
  type NotificationPreferencesDTO,
  type SessionDTO,
} from '@sat/shared';
import { env } from '../../config/env';
import { withTransaction } from '../../db/connection';
import { errors } from '../../lib/errors';
import { requireAuth } from '../../lib/request';
import { P, route } from '../../lib/route';
import { limits } from '../../middleware/rateLimit';
import {
  AnnouncementReceipt,
  Enrollment,
  ExtensionRequest,
  FileObject,
  Grade,
  Invitation,
  Membership,
  Notification,
  Organization,
  Session,
  Submission,
  SubmissionVersion,
  User,
  type FileObjectDoc,
  type InvitationDoc,
  type MembershipDoc,
  type OrganizationDoc,
  type SessionDoc,
  type UserDoc,
} from '../../models';
import { audit } from '../../services/audit';
import { deleteStoredFile, singleUpload, storeUpload, streamFile } from '../../services/files';
import { revokeAllSessions, revokeSession } from '../../services/sessions';
import { currentCsrfToken } from '../../services/tokens';
import { filterVisibleGrades } from '../../services/gradeVisibility';
import { applyInvitation, buildMe, changePassword, findPendingInvitation } from '../auth/service';
import { loadPeople, personRef } from '../common/serializers';
import { serializeUser } from './serializers';

const tags = ['Current user'];

export function meRoutes(): Router {
  const r = Router();

  route(r, {
    method: 'get',
    path: '/me',
    summary: 'Current user, organization memberships and CSRF token',
    tags,
    access: 'user',
    handler: async ({ req, res }) => {
      return buildMe(requireAuth(req).userId, currentCsrfToken(req, res));
    },
  });

  route(r, {
    method: 'patch',
    path: '/me',
    summary: 'Update profile (name, time zone, locale)',
    tags,
    access: 'user',
    body: updateProfileSchema,
    handler: async ({ req, body }) => {
      const auth = requireAuth(req);
      const user = await User.findByIdAndUpdate(
        auth.userId,
        { $set: body },
        { returnDocument: 'after', runValidators: true },
      ).lean<UserDoc>();
      if (!user) throw errors.unauthenticated();
      return serializeUser(user);
    },
  });

  route(r, {
    method: 'put',
    path: '/me/password',
    summary: 'Change password; signs out all other sessions',
    tags,
    access: 'user',
    status: 204,
    body: changePasswordSchema,
    middleware: [limits.passwordReset()],
    handler: async ({ req, body }) => {
      await changePassword(req, body.currentPassword, body.newPassword);
    },
  });

  route(r, {
    method: 'get',
    path: '/me/sessions',
    summary: 'List active sessions',
    tags,
    access: 'user',
    handler: async ({ req }): Promise<SessionDTO[]> => {
      const auth = requireAuth(req);
      const sessions = await Session.find({
        userId: auth.userId,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      })
        .sort({ lastUsedAt: -1 })
        .limit(50)
        .lean<SessionDoc[]>();
      return sessions.map((s) => ({
        id: s._id.toString(),
        userAgent: s.userAgent,
        ipPrefix: s.ipPrefix,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        current: s._id.toString() === auth.sessionId,
      }));
    },
  });

  route(r, {
    method: 'delete',
    path: '/me/sessions/:id',
    summary: 'Revoke one of your sessions',
    tags,
    access: 'user',
    status: 204,
    params: P.id,
    handler: async ({ req, params }) => {
      const auth = requireAuth(req);
      const session = await Session.findOne({ _id: params.id, userId: auth.userId }).lean();
      if (!session) throw errors.notFound('Session');
      await revokeSession(params.id, 'user_revoked');
      await audit({ req, action: 'auth.session.revoked', targetType: 'session', targetId: params.id });
    },
  });

  route(r, {
    method: 'post',
    path: '/me/sessions/revoke-others',
    summary: 'Sign out every other session',
    tags,
    access: 'user',
    status: 200,
    handler: async ({ req }) => {
      const auth = requireAuth(req);
      const revoked = await revokeAllSessions(auth.userId, 'user_revoked_others', auth.sessionId);
      await audit({ req, action: 'auth.session.revoked_others', metadata: { revoked } });
      return { revoked };
    },
  });

  route(r, {
    method: 'get',
    path: '/me/notification-preferences',
    summary: 'Notification preferences',
    tags,
    access: 'user',
    handler: async ({ req }): Promise<NotificationPreferencesDTO> => {
      const user = requireAuth(req).user;
      const prefs = user.notificationPreferences;
      return {
        inApp: prefs.inApp,
        email: prefs.email,
        reminderOffsetsMinutes: prefs.reminderOffsetsMinutes ?? null,
        effectiveReminderOffsetsMinutes: prefs.reminderOffsetsMinutes ?? [1440, 60],
      };
    },
  });

  route(r, {
    method: 'put',
    path: '/me/notification-preferences',
    summary: 'Replace notification preferences',
    tags,
    access: 'user',
    body: notificationPreferencesSchema,
    handler: async ({ req, body }) => {
      const auth = requireAuth(req);
      const offsets = body.reminderOffsetsMinutes
        ? [...new Set(body.reminderOffsetsMinutes)].sort((a, b) => b - a)
        : null;
      await User.updateOne(
        { _id: auth.userId },
        { $set: { notificationPreferences: { ...body, reminderOffsetsMinutes: offsets } } },
      );
      return {
        ...body,
        reminderOffsetsMinutes: offsets,
        effectiveReminderOffsetsMinutes: offsets ?? [1440, 60],
      };
    },
  });

  route(r, {
    method: 'put',
    path: '/me/avatar',
    summary: 'Upload a profile image (PNG, JPEG or WebP, max 2 MB)',
    tags,
    access: 'user',
    status: 200,
    requestContentType: 'multipart/form-data',
    middleware: [limits.upload(), singleUpload(LIMITS.avatarBytes)],
    handler: async ({ req }) => {
      const auth = requireAuth(req);
      if (req.file && !(AVATAR_MIME_TYPES as readonly string[]).includes(req.file.mimetype)) {
        throw errors.validation('Use a PNG, JPEG or WebP image.', { file: ['Unsupported image type'] });
      }
      const file = await storeUpload(req.file, {
        purpose: 'avatar',
        orgId: null,
        ownerId: auth.userId,
        allowedExtensions: ['png', 'jpg', 'jpeg', 'webp'],
        maxBytes: LIMITS.avatarBytes,
        attachedTo: { type: 'user', id: auth.user._id },
      });
      await FileObject.updateOne({ _id: file._id }, { $set: { status: 'attached' } });
      const previous = auth.user.avatarFileId;
      await User.updateOne({ _id: auth.userId }, { $set: { avatarFileId: file._id } });
      if (previous) {
        const old = await FileObject.findById(previous).lean<FileObjectDoc>();
        if (old) await deleteStoredFile(old);
      }
      return { hasAvatar: true };
    },
  });

  route(r, {
    method: 'delete',
    path: '/me/avatar',
    summary: 'Remove the profile image',
    tags,
    access: 'user',
    status: 204,
    handler: async ({ req }) => {
      const auth = requireAuth(req);
      if (!auth.user.avatarFileId) return;
      const file = await FileObject.findById(auth.user.avatarFileId).lean<FileObjectDoc>();
      await User.updateOne({ _id: auth.userId }, { $set: { avatarFileId: null } });
      if (file) await deleteStoredFile(file);
    },
  });

  route(r, {
    method: 'get',
    path: '/users/:id/avatar',
    summary: 'Profile image of a user who shares an organization with you',
    tags,
    access: 'user',
    params: P.id,
    responseContentType: 'image/*',
    handler: async ({ req, res, params }) => {
      const auth = requireAuth(req);
      if (params.id !== auth.userId) {
        const mine = await Membership.find({ userId: auth.userId, status: 'active' }).distinct('orgId');
        const shared = await Membership.exists({ userId: params.id, orgId: { $in: mine }, status: 'active' });
        if (!shared) throw errors.notFound('Image');
      }
      const user = await User.findById(params.id).select({ avatarFileId: 1 }).lean<UserDoc>();
      if (!user?.avatarFileId) throw errors.notFound('Image');
      const file = await FileObject.findOne({
        _id: user.avatarFileId,
        status: 'attached',
      }).lean<FileObjectDoc>();
      if (!file) throw errors.notFound('Image');
      await streamFile(req, res, file, { inline: true });
    },
  });

  route(r, {
    method: 'get',
    path: '/me/invitations',
    summary: 'Pending invitations addressed to your verified email',
    tags: ['Invitations'],
    access: 'user',
    handler: async ({ req }) => {
      const user = requireAuth(req).user;
      if (!user.emailVerifiedAt) return [];
      const invitations = await Invitation.find({
        email: user.email,
        status: 'pending',
        expiresAt: { $gt: new Date() },
      })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean<InvitationDoc[]>();
      const orgs = await Organization.find({
        _id: { $in: invitations.map((i) => i.orgId) },
        status: 'active',
      }).lean<OrganizationDoc[]>();
      const orgName = new Map(orgs.map((o) => [o._id.toString(), o.name]));
      const people = await loadPeople(invitations.map((i) => i.invitedBy));
      return invitations
        .filter((i) => orgName.has(i.orgId.toString()))
        .map((i) => ({
          id: i._id.toString(),
          orgName: orgName.get(i.orgId.toString()),
          email: i.email,
          role: i.role,
          status: i.status,
          courseId: i.courseId?.toString() ?? null,
          expiresAt: i.expiresAt.toISOString(),
          createdAt: i.createdAt.toISOString(),
          invitedBy: personRef(people, i.invitedBy),
        })) satisfies (InvitationDTO & { orgName: string | undefined })[];
    },
  });

  route(r, {
    method: 'post',
    path: '/me/invitations/:id/accept',
    summary: 'Accept an invitation addressed to your verified email',
    tags: ['Invitations'],
    access: 'user',
    status: 200,
    params: P.id,
    handler: async ({ req, params }) => {
      const auth = requireAuth(req);
      const user = auth.user;
      const inv = await Invitation.findOne({
        _id: params.id,
        email: user.email,
        status: 'pending',
      }).lean<InvitationDoc>();
      if (!inv || !user.emailVerifiedAt) throw errors.notFound('Invitation');
      if (inv.expiresAt.getTime() <= Date.now())
        throw errors.validation('This invitation has expired.', undefined, 'invitation_expired');
      const membership = await withTransaction((session) => applyInvitation(inv, user._id, session));
      return { orgId: membership.orgId.toString(), role: membership.role };
    },
  });

  route(r, {
    method: 'post',
    path: '/invitations/accept',
    summary: 'Accept an invitation by token while signed in (invited email must match)',
    tags: ['Invitations'],
    access: 'user',
    status: 200,
    body: tokenSchema,
    middleware: [limits.tokenRedemption()],
    handler: async ({ req, body }) => {
      const user = requireAuth(req).user;
      const inv = await findPendingInvitation(body.token);
      if (inv.email !== user.email) {
        throw errors.forbidden(
          'This invitation was sent to a different email address. Sign in with that account.',
          'invitation_email_mismatch',
        );
      }
      const membership = await withTransaction(async (session) => {
        // The token proves inbox ownership.
        await User.updateOne(
          { _id: user._id, emailVerifiedAt: null },
          { $set: { emailVerifiedAt: new Date() } },
          { session },
        );
        return applyInvitation(inv, user._id, session);
      });
      return { orgId: membership.orgId.toString(), role: membership.role };
    },
  });

  route(r, {
    method: 'post',
    path: '/me/join',
    summary: 'Join an organization with its join code (when self-registration is enabled)',
    tags: ['Invitations'],
    access: 'user',
    status: 200,
    body: joinOrganizationSchema,
    middleware: [limits.tokenRedemption()],
    handler: async ({ req, body }) => {
      const user = requireAuth(req).user;
      if (env().REQUIRE_EMAIL_VERIFICATION && !user.emailVerifiedAt)
        throw errors.forbidden('Verify your email address first.', 'email_not_verified');
      const org = await Organization.findOne({
        joinCode: body.joinCode.toUpperCase(),
        status: 'active',
      }).lean<OrganizationDoc>();
      if (!org || org.settings.selfRegistration === 'disabled') {
        throw errors.validation(
          'That join code is not valid.',
          { joinCode: ['Invalid code'] },
          'invalid_join_code',
        );
      }
      const domain = user.email.split('@')[1] ?? '';
      if (org.settings.allowedEmailDomains.length > 0 && !org.settings.allowedEmailDomains.includes(domain)) {
        throw errors.forbidden(
          'This organization only accepts members with an approved email domain.',
          'email_domain_not_allowed',
        );
      }
      const existing = await Membership.findOne({ orgId: org._id, userId: user._id }).lean<MembershipDoc>();
      if (existing?.status === 'revoked') {
        // A public join code must not undo an administrator's removal decision.
        throw errors.forbidden(
          'Your membership was removed by an administrator. Ask them for a new invitation.',
          'membership_revoked',
        );
      }
      if (existing) {
        return { orgId: org._id.toString(), status: existing.status };
      }
      const status = org.settings.selfRegistration === 'open' ? 'active' : 'pending';
      await Membership.updateOne(
        { orgId: org._id, userId: user._id },
        {
          $set: { role: 'student', status, joinedAt: new Date() },
          $setOnInsert: { orgId: org._id, userId: user._id },
        },
        { upsert: true },
      );
      await audit({
        req,
        orgId: org._id,
        action: 'membership.self_joined',
        targetType: 'user',
        targetId: user._id,
        metadata: { status },
      });
      return { orgId: org._id.toString(), status };
    },
  });

  route(r, {
    method: 'get',
    path: '/me/export',
    summary: 'Download a JSON export of your personal data and academic records',
    tags,
    access: 'user',
    middleware: [limits.export()],
    responseContentType: 'application/json',
    handler: async ({ req, res }) => {
      const auth = requireAuth(req);
      const userId = auth.user._id;
      const [memberships, enrollments, submissions, versions, grades, extensions, notifications, receipts] =
        await Promise.all([
          Membership.find({ userId }).lean(),
          Enrollment.find({ userId }).lean(),
          Submission.find({ studentId: userId }).lean(),
          SubmissionVersion.find({ studentId: userId }).lean(),
          // Only released grades; drafts and private instructor notes are not the student's data to export.
          Grade.find({ studentId: userId, published: { $ne: null } }).lean(),
          ExtensionRequest.find({ studentId: userId }).lean(),
          Notification.find({ userId }).sort({ createdAt: -1 }).limit(1000).lean(),
          AnnouncementReceipt.find({ userId }).lean(),
        ]);
      const payload = {
        exportedAt: new Date().toISOString(),
        user: serializeUser(auth.user),
        memberships: memberships.map((m) => ({
          orgId: m.orgId,
          role: m.role,
          status: m.status,
          joinedAt: m.joinedAt,
          studentNumber: m.studentNumber,
        })),
        enrollments: enrollments.map((e) => ({
          courseId: e.courseId,
          role: e.role,
          status: e.status,
          enrolledAt: e.enrolledAt,
        })),
        submissions: submissions.map((s) => ({
          assignmentId: s.assignmentId,
          state: s.state,
          attemptCount: s.attemptCount,
          lastSubmittedAt: s.lastSubmittedAt,
          isLate: s.isLate,
        })),
        submissionVersions: versions.map((v) => ({
          assignmentId: v.assignmentId,
          attemptNumber: v.attemptNumber,
          submittedAt: v.submittedAt,
          isLate: v.isLate,
          receiptCode: v.receiptCode,
          text: v.text,
          url: v.url,
          files: v.files.map((f) => ({ name: f.name, size: f.size, sha256: f.sha256 })),
        })),
        grades: (await filterVisibleGrades(grades)).map((g) => ({
          assignmentId: g.assignmentId,
          finalPoints: g.published?.finalPoints,
          maxPoints: g.published?.maxPoints,
          feedback: g.published?.feedback,
          publishedAt: g.publishedAt,
        })),
        extensionRequests: extensions.map((e) => ({
          assignmentId: e.assignmentId,
          status: e.status,
          requestedDueAt: e.requestedDueAt,
          approvedDueAt: e.approvedDueAt,
          reason: e.reason,
        })),
        notifications: notifications.map((n) => ({
          type: n.type,
          title: n.title,
          createdAt: n.createdAt,
          readAt: n.readAt,
        })),
        announcementReceipts: receipts.map((a) => ({
          announcementId: a.announcementId,
          readAt: a.readAt,
          acknowledgedAt: a.acknowledgedAt,
        })),
      };
      await audit({ req, action: 'user.data_exported', targetType: 'user', targetId: userId });
      res.setHeader('Content-Disposition', 'attachment; filename="my-academic-records.json"');
      res.setHeader('Cache-Control', 'no-store');
      return payload;
    },
  });

  return r;
}
