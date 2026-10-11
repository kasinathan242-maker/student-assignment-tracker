import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  createInvitationSchema,
  departmentSchema,
  listInvitationsQuerySchema,
  listMembersQuerySchema,
  rotateJoinCodeSchema,
  searchSchema,
  updateDepartmentSchema,
  updateMembershipSchema,
  updateOrgSchema,
  type DepartmentDTO,
  type InvitationDTO,
  type MemberDTO,
  type OrgDTO,
  type OrgRole,
} from '@sat/shared';
import { isDuplicateKeyError } from '../../db/connection';
import { hashToken, joinCode, randomToken } from '../../lib/crypto';
import { errors } from '../../lib/errors';
import { paginate, searchRegex, skipFor } from '../../lib/pagination';
import { requireOrg } from '../../lib/request';
import { P, route } from '../../lib/route';
import {
  Course,
  Department,
  Enrollment,
  Invitation,
  Membership,
  Organization,
  User,
  toId,
  type DepartmentDoc,
  type Id,
  type InvitationDoc,
  type MembershipDoc,
  type OrganizationDoc,
  type UserDoc,
} from '../../models';
import { actor, isOrgAdmin, requireCourseManager } from '../../services/access';
import { audit } from '../../services/audit';
import { deliver, queueEmail } from '../../services/notifications';
import { revokeAllSessions } from '../../services/sessions';
import { INVITATION_TTL_MS } from '../auth/service';
import { loadPeople, personRef } from '../common/serializers';

const ROLE_LABEL: Record<OrgRole, string> = {
  student: 'a student',
  teacher: 'a teacher',
  org_admin: 'an administrator',
};

export function serializeOrg(org: OrganizationDoc, includeSecrets: boolean): OrgDTO {
  return {
    id: org._id.toString(),
    name: org.name,
    slug: org.slug,
    status: org.status,
    timezone: org.timezone,
    settings: {
      selfRegistration: org.settings.selfRegistration,
      allowedEmailDomains: org.settings.allowedEmailDomains ?? [],
      teachersCanCreateCourses: org.settings.teachersCanCreateCourses,
      csvImportEnabled: org.settings.csvImportEnabled,
      reminderOffsetsMinutes: org.settings.reminderOffsetsMinutes ?? [],
      defaultLatePolicy: org.settings.defaultLatePolicy,
      notificationRetentionDays: org.settings.notificationRetentionDays,
      auditRetentionDays: org.settings.auditRetentionDays,
    },
    branding: { primaryColor: org.branding?.primaryColor ?? null },
    joinCode: includeSecrets ? org.joinCode : null,
    createdAt: org.createdAt.toISOString(),
  };
}

export function serializeInvitation(
  inv: InvitationDoc,
  people: Awaited<ReturnType<typeof loadPeople>>,
): InvitationDTO {
  const expired = inv.status === 'pending' && inv.expiresAt.getTime() <= Date.now();
  return {
    id: inv._id.toString(),
    email: inv.email,
    role: inv.role,
    status: expired ? 'expired' : inv.status,
    courseId: inv.courseId?.toString() ?? null,
    expiresAt: inv.expiresAt.toISOString(),
    createdAt: inv.createdAt.toISOString(),
    invitedBy: personRef(people, inv.invitedBy),
  };
}

/**
 * Creates (or refreshes) an invitation and emails it. Teachers may only invite students; role elevation
 * to teacher/admin is restricted to organization administrators.
 */
export async function createInvitation(
  req: Request,
  input: { email: string; role: OrgRole; courseId?: string | null },
): Promise<InvitationDoc> {
  const a = actor(req);
  if (input.role !== 'student' && !isOrgAdmin(a))
    throw errors.forbidden('Only administrators can invite teachers or administrators.');
  const org = requireOrg(req).org;
  if (input.courseId) {
    // The invitation enrolls the invitee on acceptance, so the inviter must be allowed to manage
    // that course's roster (instructor or administrator), not merely know that it exists.
    if (isOrgAdmin(a)) {
      if (!(await Course.exists({ _id: input.courseId, orgId: a.orgId }))) throw errors.notFound('Course');
    } else {
      await requireCourseManager(a, input.courseId, { write: true });
    }
  }

  const existingUser = await User.findOne({ email: input.email }).select({ _id: 1 }).lean<{ _id: Id }>();
  if (existingUser) {
    const m = await Membership.findOne({ orgId: a.orgId, userId: existingUser._id }).lean<MembershipDoc>();
    if (m && m.status === 'active' && !input.courseId)
      throw errors.conflict('This person is already a member of the organization.', 'already_member');
  }

  const token = randomToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  let inv: InvitationDoc | null = null;
  try {
    inv = await Invitation.findOneAndUpdate(
      { orgId: a.orgId, email: input.email, status: 'pending' },
      {
        $set: {
          role: input.role,
          tokenHash: hashToken(token),
          expiresAt,
          invitedBy: a.userId,
          courseId: input.courseId ?? null,
        },
        $setOnInsert: { orgId: a.orgId, email: input.email, status: 'pending' },
      },
      { upsert: true, returnDocument: 'after' },
    ).lean<InvitationDoc>();
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    throw errors.conflict(
      'An invitation for this email was just created. Refresh and try again.',
      'duplicate',
    );
  }
  if (!inv) throw new Error('invitation upsert failed');

  const inviter = requireOrg(req).membership ? req.auth?.user.name : undefined;
  await queueEmail(input.email, 'invitation', {
    orgName: org.name,
    inviterName: inviter ?? 'An administrator',
    roleLabel: ROLE_LABEL[input.role],
    token,
  });
  if (existingUser) {
    await deliver({
      orgId: a.orgId,
      userIds: [existingUser._id],
      type: 'invitation',
      title: `Invitation to ${org.name}`,
      body: `You were invited to join as ${ROLE_LABEL[input.role]}.`,
      link: '/join',
      refType: 'invitation',
      refId: inv._id,
      dedupeKey: `invitation:${inv._id.toString()}:${expiresAt.getTime()}`,
    });
  }
  await audit({
    req,
    action: 'invitation.created',
    targetType: 'invitation',
    targetId: inv._id,
    metadata: { role: input.role, courseId: input.courseId },
  });
  return inv;
}

async function assertNotLastAdmin(orgId: string, membership: MembershipDoc): Promise<void> {
  if (membership.role !== 'org_admin' || membership.status !== 'active') return;
  const admins = await Membership.countDocuments({ orgId, role: 'org_admin', status: 'active' });
  if (admins <= 1)
    throw errors.conflict('An organization must keep at least one active administrator.', 'last_admin');
}

export function orgRoutes(): Router {
  const r = Router();
  const tags = ['Organizations'];

  route(r, {
    method: 'get',
    path: '/orgs/:orgId',
    summary: 'Organization profile and settings',
    tags,
    access: 'org',
    params: P.org,
    handler: ({ req }) => serializeOrg(requireOrg(req).org, isOrgAdmin(actor(req))),
  });

  route(r, {
    method: 'patch',
    path: '/orgs/:orgId',
    summary: 'Update organization profile and settings',
    tags,
    access: 'org',
    orgRoles: ['org_admin'],
    params: P.org,
    body: updateOrgSchema,
    handler: async ({ req, body }) => {
      const { orgId } = requireOrg(req);
      const set: Record<string, unknown> = {};
      if (body.name) set.name = body.name;
      if (body.timezone) set.timezone = body.timezone;
      if (body.branding) set['branding.primaryColor'] = body.branding.primaryColor;
      for (const [k, v] of Object.entries(body.settings ?? {})) {
        set[`settings.${k}`] =
          k === 'reminderOffsetsMinutes' ? [...new Set(v as number[])].sort((x, y) => y - x) : v;
      }
      const org = await Organization.findByIdAndUpdate(
        orgId,
        { $set: set },
        { returnDocument: 'after', runValidators: true },
      ).lean<OrganizationDoc>();
      if (!org) throw errors.notFound('Organization');
      await audit({
        req,
        action: 'org.updated',
        targetType: 'organization',
        targetId: orgId,
        metadata: { fields: Object.keys(set) },
      });
      return serializeOrg(org, true);
    },
  });

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/join-code',
    summary: 'Rotate (enabled=true) or disable the self-registration join code',
    tags,
    access: 'org',
    orgRoles: ['org_admin'],
    status: 200,
    params: P.org,
    body: rotateJoinCodeSchema,
    handler: async ({ req, body }) => {
      const { orgId } = requireOrg(req);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          const org = await Organization.findByIdAndUpdate(
            orgId,
            { $set: { joinCode: body.enabled ? joinCode() : null } },
            { returnDocument: 'after' },
          ).lean<OrganizationDoc>();
          if (!org) throw errors.notFound('Organization');
          await audit({
            req,
            action: body.enabled ? 'org.join_code.rotated' : 'org.join_code.disabled',
            targetType: 'organization',
            targetId: orgId,
          });
          return serializeOrg(org, true);
        } catch (err) {
          if (!isDuplicateKeyError(err)) throw err;
        }
      }
      throw errors.conflict('Could not generate a unique code. Try again.');
    },
  });

  /* ───────────── members ───────────── */

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/members',
    summary: 'List organization members',
    tags: ['Members'],
    access: 'org',
    orgRoles: ['org_admin'],
    params: P.org,
    query: listMembersQuerySchema,
    handler: async ({ req, query }) => {
      const { orgId } = requireOrg(req);
      const filter: Record<string, unknown> = { orgId: toId(orgId) };
      if (query.role) filter.role = query.role;
      if (query.status) filter.status = query.status;
      const rx = searchRegex(query.q);
      if (rx) {
        const userIds = await User.find({ $or: [{ name: rx }, { email: rx }] })
          .select({ _id: 1 })
          .limit(2000)
          .distinct('_id');
        filter.$or = [{ userId: { $in: userIds } }, { studentNumber: rx }];
      }
      const desc = query.sort.startsWith('-');
      const field = query.sort.replace('-', '');
      const dir = desc ? -1 : 1;
      const pipeline: object[] = [
        { $match: filter },
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'u',
            pipeline: [{ $project: { name: 1, email: 1, lastLoginAt: 1, status: 1 } }],
          },
        },
        { $unwind: '$u' },
        { $sort: { [field === 'name' ? 'u.name' : field === 'email' ? 'u.email' : field]: dir, _id: dir } },
        {
          $facet: {
            items: [{ $skip: skipFor(query.page, query.pageSize) }, { $limit: query.pageSize }],
            total: [{ $count: 'n' }],
          },
        },
      ];
      const [result] = await Membership.aggregate<{
        items: (MembershipDoc & { u: UserDoc })[];
        total: { n: number }[];
      }>(pipeline as never);
      const items: MemberDTO[] = (result?.items ?? []).map((m) => ({
        id: m._id.toString(),
        userId: m.userId.toString(),
        name: m.u.name,
        email: m.u.email,
        role: m.role,
        status: m.status,
        studentNumber: m.studentNumber,
        departmentId: m.departmentId?.toString() ?? null,
        joinedAt: m.joinedAt.toISOString(),
        lastLoginAt: m.u.lastLoginAt?.toISOString() ?? null,
        userStatus: m.u.status,
      }));
      return paginate(items, result?.total[0]?.n ?? 0, query.page, query.pageSize);
    },
  });

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/directory',
    summary: 'Search active members (name and email only) — used by staff when enrolling people',
    tags: ['Members'],
    access: 'org',
    orgRoles: ['org_admin', 'teacher'],
    params: P.org,
    query: z.object({ q: searchSchema, role: z.enum(['student', 'teacher', 'org_admin']).optional() }),
    handler: async ({ req, query }) => {
      const { orgId } = requireOrg(req);
      const rx = searchRegex(query.q);
      if (!rx || (query.q ?? '').length < 2) return [];
      const users = await User.find({ $or: [{ name: rx }, { email: rx }], status: 'active' })
        .select({ name: 1, email: 1 })
        .limit(200)
        .lean<UserDoc[]>();
      const memberships = await Membership.find({
        orgId,
        status: 'active',
        userId: { $in: users.map((u) => u._id) },
        ...(query.role ? { role: query.role } : {}),
      })
        .limit(20)
        .lean<MembershipDoc[]>();
      const byId = new Map(users.map((u) => [u._id.toString(), u]));
      return memberships.map((m) => {
        const u = byId.get(m.userId.toString());
        return { userId: m.userId.toString(), name: u?.name ?? '', email: u?.email ?? '', role: m.role };
      });
    },
  });

  route(r, {
    method: 'patch',
    path: '/orgs/:orgId/members/:id',
    summary:
      'Change a member’s role, status, student number or department (audited; reason required for role changes)',
    tags: ['Members'],
    access: 'org',
    orgRoles: ['org_admin'],
    params: P.orgId,
    body: updateMembershipSchema,
    handler: async ({ req, params, body }) => {
      const a = actor(req);
      const membership = await Membership.findOne({ _id: params.id, orgId: a.orgId }).lean<MembershipDoc>();
      if (!membership) throw errors.notFound('Member');
      const isSelf = membership.userId.toString() === a.userId;
      if (isSelf && (body.role || body.status))
        throw errors.forbidden('You cannot change your own role or status.', 'self_change');
      if (body.role && body.role !== membership.role && !body.reason) {
        throw errors.validation('Provide a reason for this role change.', {
          reason: ['Required for role changes'],
        });
      }
      if ((body.role && body.role !== 'org_admin') || body.status === 'suspended')
        await assertNotLastAdmin(a.orgId, membership);
      if (membership.status === 'revoked' || membership.status === 'pending') {
        if (body.status)
          throw errors.conflict('Use approve or re-invite for pending and revoked members.', 'invalid_state');
      }
      if (body.departmentId && !(await Department.exists({ _id: body.departmentId, orgId: a.orgId })))
        throw errors.notFound('Department');
      const set: Record<string, unknown> = {};
      for (const key of ['role', 'status', 'studentNumber', 'departmentId'] as const)
        if (body[key] !== undefined) set[key] = body[key];
      let updated: MembershipDoc | null;
      try {
        updated = await Membership.findOneAndUpdate(
          { _id: params.id, orgId: a.orgId },
          { $set: set },
          { returnDocument: 'after' },
        ).lean<MembershipDoc>();
      } catch (err) {
        if (isDuplicateKeyError(err))
          throw errors.conflict('That student number is already in use.', 'duplicate', {
            studentNumber: ['Already in use'],
          });
        throw err;
      }
      if (!updated) throw errors.notFound('Member');
      if (body.status === 'suspended') await revokeAllSessions(membership.userId, 'membership_suspended');
      await audit({
        req,
        action: body.role && body.role !== membership.role ? 'membership.role_changed' : 'membership.updated',
        targetType: 'membership',
        targetId: params.id,
        metadata: {
          userId: membership.userId,
          from: { role: membership.role, status: membership.status },
          to: set,
          reason: body.reason,
        },
      });
      if (body.role && body.role !== membership.role) {
        await deliver({
          orgId: a.orgId,
          userIds: [membership.userId],
          type: 'membership',
          title: 'Your role changed',
          body: `Your role is now ${ROLE_LABEL[body.role].replace(/^an? /, '')}.`,
          link: `/o/${a.orgId}`,
          dedupeKey: `role:${params.id}:${Date.now()}`,
        });
      }
      return { id: updated._id.toString(), role: updated.role, status: updated.status };
    },
  });

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/members/:id/approve',
    summary: 'Approve a pending self-registered member',
    tags: ['Members'],
    access: 'org',
    orgRoles: ['org_admin'],
    status: 200,
    params: P.orgId,
    handler: async ({ req, params }) => {
      const a = actor(req);
      const m = await Membership.findOneAndUpdate(
        { _id: params.id, orgId: a.orgId, status: 'pending' },
        { $set: { status: 'active', joinedAt: new Date() } },
        { returnDocument: 'after' },
      ).lean<MembershipDoc>();
      if (!m) throw errors.notFound('Pending member');
      await audit({
        req,
        action: 'membership.approved',
        targetType: 'membership',
        targetId: params.id,
        metadata: { userId: m.userId },
      });
      await deliver({
        orgId: a.orgId,
        userIds: [m.userId],
        type: 'membership',
        title: `Welcome to ${requireOrg(req).org.name}`,
        body: 'Your membership request was approved.',
        link: `/o/${a.orgId}`,
        dedupeKey: `approved:${params.id}`,
      });
      return { id: m._id.toString(), status: m.status };
    },
  });

  route(r, {
    method: 'delete',
    path: '/orgs/:orgId/members/:id',
    summary: 'Revoke a membership (records are retained; access is removed immediately)',
    tags: ['Members'],
    access: 'org',
    orgRoles: ['org_admin'],
    status: 204,
    params: P.orgId,
    body: z.object({ reason: z.string().trim().min(1).max(1000) }).strict(),
    handler: async ({ req, params, body }) => {
      const a = actor(req);
      const m = await Membership.findOne({ _id: params.id, orgId: a.orgId }).lean<MembershipDoc>();
      if (!m) throw errors.notFound('Member');
      if (m.userId.toString() === a.userId)
        throw errors.forbidden('You cannot revoke your own membership.', 'self_change');
      await assertNotLastAdmin(a.orgId, m);
      await Membership.updateOne({ _id: m._id }, { $set: { status: 'revoked' } });
      await Enrollment.updateMany(
        { orgId: a.orgId, userId: m.userId, status: 'active' },
        { $set: { status: 'dropped', droppedAt: new Date() } },
      );
      await audit({
        req,
        action: 'membership.revoked',
        targetType: 'membership',
        targetId: params.id,
        metadata: { userId: m.userId, reason: body.reason },
      });
    },
  });

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/members/:id/revoke-sessions',
    summary: 'Sign a member out of all sessions (e.g. suspected compromise)',
    tags: ['Members'],
    access: 'org',
    orgRoles: ['org_admin'],
    status: 200,
    params: P.orgId,
    handler: async ({ req, params }) => {
      const a = actor(req);
      const m = await Membership.findOne({ _id: params.id, orgId: a.orgId }).lean<MembershipDoc>();
      if (!m) throw errors.notFound('Member');
      const revoked = await revokeAllSessions(m.userId, 'admin_revoked');
      await audit({
        req,
        action: 'membership.sessions_revoked',
        targetType: 'membership',
        targetId: params.id,
        metadata: { userId: m.userId, revoked },
      });
      return { revoked };
    },
  });

  /* ───────────── invitations ───────────── */

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/invitations',
    summary: 'List invitations',
    tags: ['Invitations'],
    access: 'org',
    orgRoles: ['org_admin'],
    params: P.org,
    query: listInvitationsQuerySchema,
    handler: async ({ req, query }) => {
      const { orgId } = requireOrg(req);
      const filter: Record<string, unknown> = { orgId };
      const now = new Date();
      if (query.status === 'expired')
        Object.assign(filter, {
          $or: [{ status: 'expired' }, { status: 'pending', expiresAt: { $lte: now } }],
        });
      else if (query.status === 'pending')
        Object.assign(filter, { status: 'pending', expiresAt: { $gt: now } });
      else if (query.status) filter.status = query.status;
      const rx = searchRegex(query.q);
      if (rx) filter.email = rx;
      const [items, total] = await Promise.all([
        Invitation.find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip(skipFor(query.page, query.pageSize))
          .limit(query.pageSize)
          .lean<InvitationDoc[]>(),
        Invitation.countDocuments(filter),
      ]);
      const people = await loadPeople(items.map((i) => i.invitedBy));
      return paginate(
        items.map((i) => serializeInvitation(i, people)),
        total,
        query.page,
        query.pageSize,
      );
    },
  });

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/invitations',
    summary: 'Invite someone (teachers may invite students only)',
    tags: ['Invitations'],
    access: 'org',
    orgRoles: ['org_admin', 'teacher'],
    params: P.org,
    body: createInvitationSchema,
    handler: async ({ req, body }) => {
      const inv = await createInvitation(req, body);
      return serializeInvitation(inv, await loadPeople([inv.invitedBy]));
    },
  });

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/invitations/:id/revoke',
    summary: 'Revoke a pending invitation',
    tags: ['Invitations'],
    access: 'org',
    orgRoles: ['org_admin'],
    status: 200,
    params: P.orgId,
    handler: async ({ req, params }) => {
      const { orgId } = requireOrg(req);
      const inv = await Invitation.findOneAndUpdate(
        { _id: params.id, orgId, status: 'pending' },
        { $set: { status: 'revoked' } },
        { returnDocument: 'after' },
      ).lean<InvitationDoc>();
      if (!inv) throw errors.notFound('Pending invitation');
      await audit({ req, action: 'invitation.revoked', targetType: 'invitation', targetId: params.id });
      return serializeInvitation(inv, await loadPeople([inv.invitedBy]));
    },
  });

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/invitations/:id/resend',
    summary: 'Re-send an invitation with a fresh link and expiry',
    tags: ['Invitations'],
    access: 'org',
    orgRoles: ['org_admin'],
    status: 200,
    params: P.orgId,
    handler: async ({ req, params }) => {
      const { orgId } = requireOrg(req);
      const inv = await Invitation.findOne({
        _id: params.id,
        orgId,
        status: { $in: ['pending', 'expired'] },
      }).lean<InvitationDoc>();
      if (!inv) throw errors.notFound('Invitation');
      if (inv.status === 'expired')
        await Invitation.updateOne({ _id: inv._id }, { $set: { status: 'revoked' } });
      const fresh = await createInvitation(req, {
        email: inv.email,
        role: inv.role,
        courseId: inv.courseId?.toString() ?? null,
      });
      return serializeInvitation(fresh, await loadPeople([fresh.invitedBy]));
    },
  });

  /* ───────────── departments ───────────── */

  const serializeDept = (d: DepartmentDoc, courseCount: number): DepartmentDTO => ({
    id: d._id.toString(),
    name: d.name,
    code: d.code,
    status: d.status,
    courseCount,
  });

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/departments',
    summary: 'List departments',
    tags: ['Departments'],
    access: 'org',
    params: P.org,
    handler: async ({ req }) => {
      const { orgId } = requireOrg(req);
      const depts = await Department.find({ orgId }).sort({ code: 1 }).limit(500).lean<DepartmentDoc[]>();
      const counts = await Course.aggregate<{ _id: Id; n: number }>([
        { $match: { orgId: toId(orgId), departmentId: { $ne: null } } },
        { $group: { _id: '$departmentId', n: { $sum: 1 } } },
      ]);
      const byId = new Map(counts.map((c) => [c._id.toString(), c.n]));
      return depts.map((d) => serializeDept(d, byId.get(d._id.toString()) ?? 0));
    },
  });

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/departments',
    summary: 'Create a department',
    tags: ['Departments'],
    access: 'org',
    orgRoles: ['org_admin'],
    params: P.org,
    body: departmentSchema,
    handler: async ({ req, body }) => {
      const { orgId } = requireOrg(req);
      try {
        const d = await Department.create({ orgId, ...body });
        await audit({
          req,
          action: 'department.created',
          targetType: 'department',
          targetId: d._id,
          metadata: body,
        });
        return serializeDept(d.toObject() as DepartmentDoc, 0);
      } catch (err) {
        if (isDuplicateKeyError(err))
          throw errors.conflict('A department with this code already exists.', 'duplicate', {
            code: ['Already in use'],
          });
        throw err;
      }
    },
  });

  route(r, {
    method: 'patch',
    path: '/orgs/:orgId/departments/:id',
    summary: 'Update or archive a department',
    tags: ['Departments'],
    access: 'org',
    orgRoles: ['org_admin'],
    params: P.orgId,
    body: updateDepartmentSchema,
    handler: async ({ req, params, body }) => {
      const { orgId } = requireOrg(req);
      try {
        const d = await Department.findOneAndUpdate(
          { _id: params.id, orgId },
          { $set: body },
          { returnDocument: 'after' },
        ).lean<DepartmentDoc>();
        if (!d) throw errors.notFound('Department');
        await audit({
          req,
          action: 'department.updated',
          targetType: 'department',
          targetId: params.id,
          metadata: body,
        });
        return serializeDept(d, await Course.countDocuments({ orgId, departmentId: d._id }));
      } catch (err) {
        if (isDuplicateKeyError(err))
          throw errors.conflict('A department with this code already exists.', 'duplicate', {
            code: ['Already in use'],
          });
        throw err;
      }
    },
  });

  return r;
}
