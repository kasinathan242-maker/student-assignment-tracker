import { Router } from 'express';
import { auditQuerySchema, type AuditLogDTO } from '@sat/shared';
import { sendCsv, toCsv } from '../../lib/csv';
import { paginate, skipFor } from '../../lib/pagination';
import { requireOrg } from '../../lib/request';
import { P, route } from '../../lib/route';
import { limits } from '../../middleware/rateLimit';
import {
  AuditLog,
  Membership,
  User,
  toId,
  type AuditLogDoc,
  type MembershipDoc,
  type UserDoc,
} from '../../models';
import { audit } from '../../services/audit';
import { loadPeople } from '../common/serializers';

export async function serializeAudit(rows: AuditLogDoc[]): Promise<AuditLogDTO[]> {
  const people = await loadPeople(rows.map((r) => r.actorId));
  return rows.map((r) => {
    const p = r.actorId ? people.get(r.actorId.toString()) : undefined;
    return {
      id: r._id.toString(),
      action: r.action,
      actor: p ? { id: p.id, name: p.name, email: p.email } : null,
      targetType: r.targetType,
      targetId: r.targetId,
      metadata: r.metadata ?? {},
      ip: r.ip,
      requestId: r.requestId,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

/** Builds an allowlisted audit filter; `action` is an exact match or a prefix ending in "." (e.g. "grade."). */
export function auditFilter(
  base: Record<string, unknown>,
  q: { action?: string; actorId?: string; targetType?: string; from?: string; to?: string },
): Record<string, unknown> {
  const filter: Record<string, unknown> = { ...base };
  if (q.action) {
    const safe = q.action.replace(/[^a-z_.]/gi, '');
    filter.action = safe.endsWith('.') ? { $regex: `^${safe.replace(/\./g, '\\.')}` } : safe;
  }
  if (q.actorId) filter.actorId = toId(q.actorId);
  if (q.targetType) filter.targetType = q.targetType.replace(/[^a-z_]/gi, '');
  if (q.from || q.to)
    filter.createdAt = {
      ...(q.from ? { $gte: new Date(q.from) } : {}),
      ...(q.to ? { $lte: new Date(q.to) } : {}),
    };
  return filter;
}

export function auditRoutes(): Router {
  const r = Router();
  const tags = ['Audit & exports'];

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/audit-logs',
    summary: 'Search the organization audit log',
    tags,
    access: 'org',
    orgRoles: ['org_admin'],
    params: P.org,
    query: auditQuerySchema,
    handler: async ({ req, query }) => {
      const filter = auditFilter({ orgId: toId(requireOrg(req).orgId) }, query);
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
    path: '/orgs/:orgId/audit-logs.csv',
    summary: 'Export matching audit records as CSV (max 10,000 rows)',
    tags,
    access: 'org',
    orgRoles: ['org_admin'],
    params: P.org,
    query: auditQuerySchema,
    responseContentType: 'text/csv',
    middleware: [limits.export()],
    handler: async ({ req, res, query }) => {
      const filter = auditFilter({ orgId: toId(requireOrg(req).orgId) }, query);
      const rows = await serializeAudit(
        await AuditLog.find(filter).sort({ createdAt: -1 }).limit(10_000).lean<AuditLogDoc[]>(),
      );
      await audit({ req, action: 'audit.exported', metadata: { rows: rows.length } });
      sendCsv(
        res,
        'audit-log.csv',
        toCsv(
          [
            'time',
            'action',
            'actor',
            'actor_email',
            'target_type',
            'target_id',
            'ip',
            'request_id',
            'details',
          ],
          rows.map((x) => [
            x.createdAt,
            x.action,
            x.actor?.name ?? '',
            x.actor?.email ?? '',
            x.targetType ?? '',
            x.targetId ?? '',
            x.ip ?? '',
            x.requestId ?? '',
            JSON.stringify(x.metadata),
          ]),
        ),
      );
    },
  });

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/exports/members.csv',
    summary: 'Export organization members as CSV',
    tags,
    access: 'org',
    orgRoles: ['org_admin'],
    params: P.org,
    responseContentType: 'text/csv',
    middleware: [limits.export()],
    handler: async ({ req, res }) => {
      const { orgId } = requireOrg(req);
      const members = await Membership.find({ orgId }).limit(50_000).lean<MembershipDoc[]>();
      const users = await User.find({ _id: { $in: members.map((m) => m.userId) } })
        .select({ name: 1, email: 1, lastLoginAt: 1 })
        .lean<UserDoc[]>();
      const byId = new Map(users.map((u) => [u._id.toString(), u]));
      await audit({ req, action: 'members.exported', metadata: { rows: members.length } });
      sendCsv(
        res,
        'members.csv',
        toCsv(
          ['name', 'email', 'role', 'status', 'student_number', 'joined_at', 'last_login_at'],
          members.map((m) => {
            const u = byId.get(m.userId.toString());
            return [
              u?.name ?? '',
              u?.email ?? '',
              m.role,
              m.status,
              m.studentNumber ?? '',
              m.joinedAt,
              u?.lastLoginAt ?? '',
            ];
          }),
        ),
      );
    },
  });

  return r;
}
