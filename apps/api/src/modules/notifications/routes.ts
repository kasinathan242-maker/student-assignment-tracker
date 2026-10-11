import { Router } from 'express';
import { z } from 'zod';
import { listNotificationsQuerySchema, objectIdSchema, type NotificationDTO } from '@sat/shared';
import { errors } from '../../lib/errors';
import { paginate, skipFor } from '../../lib/pagination';
import { requireAuth } from '../../lib/request';
import { P, route } from '../../lib/route';
import { Notification, toId, type NotificationDoc } from '../../models';

const tags = ['Notifications'];

const serialize = (n: NotificationDoc): NotificationDTO => ({
  id: n._id.toString(),
  orgId: n.orgId?.toString() ?? null,
  type: n.type,
  title: n.title,
  body: n.body,
  link: n.link,
  readAt: n.readAt?.toISOString() ?? null,
  createdAt: n.createdAt.toISOString(),
});

export function notificationRoutes(): Router {
  const r = Router();

  route(r, {
    method: 'get',
    path: '/notifications',
    summary: 'My notifications (newest first)',
    tags,
    access: 'user',
    query: listNotificationsQuerySchema,
    handler: async ({ req, query }) => {
      const filter: Record<string, unknown> = { userId: toId(requireAuth(req).userId) };
      if (query.unreadOnly) filter.readAt = null;
      if (query.orgId) filter.orgId = toId(query.orgId);
      const [rows, total] = await Promise.all([
        Notification.find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip(skipFor(query.page, query.pageSize))
          .limit(query.pageSize)
          .lean<NotificationDoc[]>(),
        Notification.countDocuments(filter),
      ]);
      return paginate(rows.map(serialize), total, query.page, query.pageSize);
    },
  });

  route(r, {
    method: 'get',
    path: '/notifications/unread-count',
    summary: 'Number of unread notifications',
    tags,
    access: 'user',
    handler: async ({ req }) => ({
      count: await Notification.countDocuments({ userId: toId(requireAuth(req).userId), readAt: null }),
    }),
  });

  route(r, {
    method: 'post',
    path: '/notifications/:id/read',
    summary: 'Mark one notification as read',
    tags,
    access: 'user',
    status: 204,
    params: P.id,
    handler: async ({ req, params }) => {
      const owner = { _id: params.id, userId: requireAuth(req).userId };
      if (!(await Notification.exists(owner))) throw errors.notFound('Notification');
      await Notification.updateOne({ ...owner, readAt: null }, { $set: { readAt: req.receivedAt } });
    },
  });

  route(r, {
    method: 'post',
    path: '/notifications/read-all',
    summary: 'Mark all (optionally one organization’s) notifications as read',
    tags,
    access: 'user',
    status: 200,
    body: z.object({ orgId: objectIdSchema.optional() }).strict(),
    handler: async ({ req, body }) => {
      const filter: Record<string, unknown> = { userId: requireAuth(req).userId, readAt: null };
      if (body.orgId) filter.orgId = body.orgId;
      const result = await Notification.updateMany(filter, { $set: { readAt: req.receivedAt } });
      return { updated: result.modifiedCount };
    },
  });

  return r;
}
