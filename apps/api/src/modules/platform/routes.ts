import { Router } from 'express';
import { z } from 'zod';
import {
  auditQuerySchema,
  createOrgSchema,
  platformOrgsQuerySchema,
  platformRoleSchema,
  platformUsersQuerySchema,
  setOrgStatusSchema,
  type PlatformOrgDTO,
  type PlatformUserDTO,
} from '@sat/shared';
import { isDuplicateKeyError } from '../../db/connection';
import { hashToken, randomToken } from '../../lib/crypto';
import { errors } from '../../lib/errors';
import { paginate, searchRegex, skipFor } from '../../lib/pagination';
import { requireAuth } from '../../lib/request';
import { P, route } from '../../lib/route';
import {
  AuditLog,
  Course,
  Invitation,
  Membership,
  Organization,
  User,
  defaultOrgSettings,
  type AuditLogDoc,
  type Id,
  type OrganizationDoc,
  type UserDoc,
} from '../../models';
import { audit } from '../../services/audit';
import { queueEmail } from '../../services/notifications';
import { revokeAllSessions } from '../../services/sessions';
import { INVITATION_TTL_MS } from '../auth/service';
import { auditFilter, serializeAudit } from '../audit/routes';
import { detailedHealth } from '../health/routes';
import { serializeOrg } from '../orgs/routes';

/**
 * Platform administration (cross-tenant operations). Separate from organization administration: platform
 * admins manage the tenant registry and platform roles, but do not gain access to any organization's
 * academic data. The role can only be granted by another platform admin or the bootstrap CLI.
 */
export function platformRoutes(): Router {
  const r = Router();
  const tags = ['Platform administration'];

  route(r, {
    method: 'get',
    path: '/platform/orgs',
    summary: 'Organization registry',
    tags,
    access: 'platform',
    query: platformOrgsQuerySchema,
    handler: async ({ query }) => {
      const filter: Record<string, unknown> = {};
      if (query.status) filter.status = query.status;
      const rx = searchRegex(query.q);
      if (rx) filter.$or = [{ name: rx }, { slug: rx }];
      const [rows, total] = await Promise.all([
        Organization.find(filter)
          .sort({ name: 1, _id: 1 })
          .skip(skipFor(query.page, query.pageSize))
          .limit(query.pageSize)
          .lean<OrganizationDoc[]>(),
        Organization.countDocuments(filter),
      ]);
      const ids = rows.map((o) => o._id);
      const [members, courses] = await Promise.all([
        Membership.aggregate<{ _id: Id; n: number }>([
          { $match: { orgId: { $in: ids }, status: 'active' } },
          { $group: { _id: '$orgId', n: { $sum: 1 } } },
        ]),
        Course.aggregate<{ _id: Id; n: number }>([
          { $match: { orgId: { $in: ids } } },
          { $group: { _id: '$orgId', n: { $sum: 1 } } },
        ]),
      ]);
      const m = new Map(members.map((x) => [x._id.toString(), x.n]));
      const c = new Map(courses.map((x) => [x._id.toString(), x.n]));
      const items: PlatformOrgDTO[] = rows.map((o) => {
        const { joinCode: _j, ...dto } = serializeOrg(o, false);
        return {
          ...dto,
          memberCount: m.get(o._id.toString()) ?? 0,
          courseCount: c.get(o._id.toString()) ?? 0,
        };
      });
      return paginate(items, total, query.page, query.pageSize);
    },
  });

  route(r, {
    method: 'post',
    path: '/platform/orgs',
    summary: 'Create an organization and invite its first administrator',
    tags,
    access: 'platform',
    body: createOrgSchema,
    handler: async ({ req, body }) => {
      const auth = requireAuth(req);
      let org: OrganizationDoc;
      try {
        org = (
          await Organization.create({
            name: body.name,
            slug: body.slug,
            timezone: body.timezone,
            settings: defaultOrgSettings(),
            createdBy: auth.userId,
          })
        ).toObject() as OrganizationDoc;
      } catch (err) {
        if (isDuplicateKeyError(err))
          throw errors.conflict('That identifier is already taken.', 'duplicate', {
            slug: ['Already in use'],
          });
        throw err;
      }
      const token = randomToken();
      await Invitation.create({
        orgId: org._id,
        email: body.adminEmail,
        role: 'org_admin',
        tokenHash: hashToken(token),
        invitedBy: auth.userId,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      });
      await queueEmail(body.adminEmail, 'invitation', {
        orgName: org.name,
        inviterName: 'The platform team',
        roleLabel: 'an administrator',
        token,
      });
      await audit({
        req,
        orgId: org._id,
        action: 'platform.org_created',
        targetType: 'organization',
        targetId: org._id,
        metadata: { slug: org.slug, adminEmail: body.adminEmail },
      });
      return serializeOrg(org, false);
    },
  });

  route(r, {
    method: 'patch',
    path: '/platform/orgs/:id/status',
    summary: 'Suspend or reactivate an organization (reason required)',
    tags,
    access: 'platform',
    params: P.id,
    body: setOrgStatusSchema,
    handler: async ({ req, params, body }) => {
      const org = await Organization.findByIdAndUpdate(
        params.id,
        { $set: { status: body.status } },
        { returnDocument: 'after' },
      ).lean<OrganizationDoc>();
      if (!org) throw errors.notFound('Organization');
      await audit({
        req,
        orgId: org._id,
        action: `platform.org_${body.status === 'suspended' ? 'suspended' : 'reactivated'}`,
        targetType: 'organization',
        targetId: org._id,
        metadata: { reason: body.reason },
      });
      return serializeOrg(org, false);
    },
  });

  route(r, {
    method: 'get',
    path: '/platform/users',
    summary: 'Search user accounts',
    tags,
    access: 'platform',
    query: platformUsersQuerySchema,
    handler: async ({ query }) => {
      const filter: Record<string, unknown> = {};
      const rx = searchRegex(query.q);
      if (rx) filter.$or = [{ name: rx }, { email: rx }];
      if (query.platformAdmin != null) filter.platformRole = query.platformAdmin ? 'platform_admin' : null;
      const [rows, total] = await Promise.all([
        User.find(filter)
          .sort({ email: 1, _id: 1 })
          .skip(skipFor(query.page, query.pageSize))
          .limit(query.pageSize)
          .lean<UserDoc[]>(),
        User.countDocuments(filter),
      ]);
      const counts = await Membership.aggregate<{ _id: Id; n: number }>([
        { $match: { userId: { $in: rows.map((u) => u._id) }, status: 'active' } },
        { $group: { _id: '$userId', n: { $sum: 1 } } },
      ]);
      const n = new Map(counts.map((c) => [c._id.toString(), c.n]));
      const items: PlatformUserDTO[] = rows.map((u) => ({
        id: u._id.toString(),
        name: u.name,
        email: u.email,
        status: u.status,
        platformRole: u.platformRole ?? null,
        emailVerified: Boolean(u.emailVerifiedAt),
        membershipCount: n.get(u._id.toString()) ?? 0,
        createdAt: u.createdAt.toISOString(),
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      }));
      return paginate(items, total, query.page, query.pageSize);
    },
  });

  route(r, {
    method: 'post',
    path: '/platform/users/:id/platform-role',
    summary: 'Grant or revoke the platform administrator role (reason required; audited)',
    tags,
    access: 'platform',
    status: 200,
    params: P.id,
    body: platformRoleSchema,
    handler: async ({ req, params, body }) => {
      const auth = requireAuth(req);
      if (params.id === auth.userId)
        throw errors.forbidden('You cannot change your own platform role.', 'self_change');
      const user = await User.findById(params.id).lean<UserDoc>();
      if (!user) throw errors.notFound('User');
      if (body.grant && (!user.emailVerifiedAt || user.status !== 'active')) {
        throw errors.conflict(
          'Only active, verified accounts can become platform administrators.',
          'ineligible',
        );
      }
      await User.updateOne(
        { _id: user._id },
        { $set: { platformRole: body.grant ? 'platform_admin' : null } },
      );
      // Changing privileges forces re-authentication everywhere.
      await revokeAllSessions(user._id, 'platform_role_changed');
      await audit({
        req,
        action: body.grant ? 'platform.role_granted' : 'platform.role_revoked',
        targetType: 'user',
        targetId: user._id,
        metadata: { reason: body.reason },
      });
      return { id: user._id.toString(), platformRole: body.grant ? 'platform_admin' : null };
    },
  });

  route(r, {
    method: 'patch',
    path: '/platform/users/:id/status',
    summary: 'Suspend, deactivate or reactivate an account (e.g. compromise response); revokes sessions',
    tags,
    access: 'platform',
    params: P.id,
    body: z
      .object({
        status: z.enum(['active', 'suspended', 'deactivated']),
        reason: z.string().trim().min(1).max(1000),
      })
      .strict(),
    handler: async ({ req, params, body }) => {
      const auth = requireAuth(req);
      if (params.id === auth.userId)
        throw errors.forbidden('You cannot change your own account status.', 'self_change');
      const user = await User.findByIdAndUpdate(
        params.id,
        { $set: { status: body.status } },
        { returnDocument: 'after' },
      ).lean<UserDoc>();
      if (!user) throw errors.notFound('User');
      if (body.status !== 'active') await revokeAllSessions(user._id, `account_${body.status}`);
      await audit({
        req,
        action: `platform.user_${body.status}`,
        targetType: 'user',
        targetId: user._id,
        metadata: { reason: body.reason },
      });
      return { id: user._id.toString(), status: user.status };
    },
  });

  route(r, {
    method: 'get',
    path: '/platform/audit-logs',
    summary: 'Platform-wide audit search',
    tags,
    access: 'platform',
    query: auditQuerySchema,
    handler: async ({ query }) => {
      const filter = auditFilter({}, query);
      const [rows, total] = await Promise.all([
        AuditLog.find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip(skipFor(query.page, query.pageSize))
          .limit(query.pageSize)
          .lean<AuditLogDoc[]>(),
        AuditLog.countDocuments(filter),
      ]);
      return paginate(await serializeAudit(rows), total, query.page, query.pageSize);
    },
  });

  route(r, {
    method: 'get',
    path: '/platform/health',
    summary: 'Service health: database, storage, Redis, worker heartbeat and outbox backlog',
    tags,
    access: 'platform',
    handler: () => detailedHealth(),
  });

  return r;
}
