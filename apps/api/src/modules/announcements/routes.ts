import { Router } from 'express';
import {
  createAnnouncementSchema,
  listAnnouncementsQuerySchema,
  updateAnnouncementSchema,
  type AnnouncementDTO,
} from '@sat/shared';
import { withTransaction } from '../../db/connection';
import { errors } from '../../lib/errors';
import { paginate, skipFor } from '../../lib/pagination';
import { P, route } from '../../lib/route';
import {
  Announcement,
  AnnouncementReceipt,
  Course,
  isValidId,
  toId,
  type AnnouncementDoc,
  type AnnouncementReceiptDoc,
  type CourseDoc,
  type Id,
} from '../../models';
import { actor, isOrgAdmin, loadCourseAccess, myCourseIds, type Actor } from '../../services/access';
import { audit } from '../../services/audit';
import { enqueue } from '../../services/outbox';
import { loadPeople, personRef } from '../common/serializers';

const tags = ['Announcements'];

/** Audiences an org member can receive, based on their organization role. */
function audiencesFor(a: Actor): string[] {
  return a.orgRole === 'student' ? ['org_all', 'org_students'] : ['org_all', 'org_teachers'];
}

/** Mongo filter for announcements currently visible to the caller (published, live, in their audience). */
export async function visibleFilter(
  a: Actor,
  now: Date,
  courseId?: string,
): Promise<Record<string, unknown>> {
  const courses = [...(await myCourseIds(a, 'student')), ...(await myCourseIds(a, 'instructor'))];
  const live = {
    status: 'published',
    publishedAt: { $lte: now },
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  };
  if (courseId) {
    if (!courses.some((c) => c.toString() === courseId)) return { _id: null };
    return { orgId: toId(a.orgId), ...live, courseId: toId(courseId) };
  }
  return {
    orgId: toId(a.orgId),
    ...live,
    $and: [{ $or: [{ courseId: { $in: courses } }, { courseId: null, audience: { $in: audiencesFor(a) } }] }],
  };
}

async function canManage(a: Actor, ann: Pick<AnnouncementDoc, 'courseId' | 'authorId'>): Promise<boolean> {
  if (ann.courseId) {
    try {
      const access = await loadCourseAccess(a, ann.courseId);
      return access.isInstructor || access.isAdmin;
    } catch {
      return false;
    }
  }
  return isOrgAdmin(a);
}

async function serialize(
  a: Actor,
  rows: AnnouncementDoc[],
  manageable: Set<string>,
): Promise<AnnouncementDTO[]> {
  const ids = rows.map((x) => x._id);
  const [people, courses, receipts, stats] = await Promise.all([
    loadPeople(rows.map((x) => x.authorId)),
    Course.find({ _id: { $in: rows.map((x) => x.courseId).filter(Boolean) } })
      .select({ code: 1 })
      .lean<CourseDoc[]>(),
    AnnouncementReceipt.find({ announcementId: { $in: ids }, userId: a.userId }).lean<
      AnnouncementReceiptDoc[]
    >(),
    manageable.size
      ? AnnouncementReceipt.aggregate<{ _id: Id; read: number; ack: number }>([
          { $match: { announcementId: { $in: ids.filter((id) => manageable.has(id.toString())) } } },
          {
            $group: {
              _id: '$announcementId',
              read: { $sum: { $cond: [{ $ne: ['$readAt', null] }, 1, 0] } },
              ack: { $sum: { $cond: [{ $ne: ['$acknowledgedAt', null] }, 1, 0] } },
            },
          },
        ])
      : Promise.resolve([]),
  ]);
  const code = new Map(courses.map((c) => [c._id.toString(), c.code]));
  const receipt = new Map(receipts.map((x) => [x.announcementId.toString(), x]));
  const stat = new Map(stats.map((s) => [s._id.toString(), s]));
  return rows.map((x) => {
    const key = x._id.toString();
    const mine = receipt.get(key);
    const manage = manageable.has(key);
    return {
      id: key,
      orgId: x.orgId.toString(),
      courseId: x.courseId?.toString() ?? null,
      courseCode: x.courseId ? (code.get(x.courseId.toString()) ?? null) : null,
      title: x.title,
      body: x.body,
      audience: x.audience,
      status: x.status,
      publishAt: x.publishAt?.toISOString() ?? null,
      publishedAt: x.publishedAt?.toISOString() ?? null,
      expiresAt: x.expiresAt?.toISOString() ?? null,
      requireAck: x.requireAck,
      sendEmail: x.sendEmail,
      author: personRef(people, x.authorId),
      readAt: mine?.readAt?.toISOString() ?? null,
      acknowledgedAt: mine?.acknowledgedAt?.toISOString() ?? null,
      canManage: manage,
      rev: x.rev,
      createdAt: x.createdAt.toISOString(),
      updatedAt: x.updatedAt.toISOString(),
      stats: manage ? { read: stat.get(key)?.read ?? 0, acknowledged: stat.get(key)?.ack ?? 0 } : null,
    };
  });
}

async function loadForManage(a: Actor, id: string): Promise<AnnouncementDoc> {
  if (!isValidId(id)) throw errors.notFound('Announcement');
  const ann = await Announcement.findOne({ _id: id, orgId: a.orgId }).lean<AnnouncementDoc>();
  if (!ann || !(await canManage(a, ann))) throw errors.notFound('Announcement');
  return ann;
}

export function announcementRoutes(): Router {
  const r = Router();

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/announcements',
    summary: 'Announcements visible to me, or (manage=true) announcements I can manage, including drafts',
    tags,
    access: 'org',
    params: P.org,
    query: listAnnouncementsQuerySchema,
    handler: async ({ req, query }) => {
      const a = actor(req);
      let filter: Record<string, unknown>;
      if (query.manage) {
        const taught = await myCourseIds(a, 'instructor');
        // Administrators manage every announcement in the org; instructors manage their courses' announcements.
        filter = { orgId: toId(a.orgId), ...(isOrgAdmin(a) ? {} : { courseId: { $in: taught } }) };
        if (query.courseId) filter.courseId = toId(query.courseId);
        if (query.status) filter.status = query.status;
      } else {
        filter = await visibleFilter(a, req.receivedAt, query.courseId);
      }
      const [rows, total] = await Promise.all([
        Announcement.find(filter)
          .sort({ publishedAt: -1, createdAt: -1, _id: -1 })
          .skip(skipFor(query.page, query.pageSize))
          .limit(query.pageSize)
          .lean<AnnouncementDoc[]>(),
        Announcement.countDocuments(filter),
      ]);
      const manageable = new Set<string>();
      for (const row of rows) if (await canManage(a, row)) manageable.add(row._id.toString());
      return paginate(await serialize(a, rows, manageable), total, query.page, query.pageSize);
    },
  });

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/announcements',
    summary: 'Create a course announcement (instructors) or organization announcement (administrators)',
    tags,
    access: 'org',
    orgRoles: ['teacher', 'org_admin'],
    params: P.org,
    body: createAnnouncementSchema,
    handler: async ({ req, body }) => {
      const a = actor(req);
      if (body.courseId) {
        const access = await loadCourseAccess(a, body.courseId);
        if (!access.canManage) throw errors.notFound('Course');
        if (access.course.status === 'archived')
          throw errors.conflict('This course is archived.', 'course_archived');
      } else if (!isOrgAdmin(a)) {
        throw errors.forbidden('Only administrators can post organization-wide announcements.');
      }
      const now = req.receivedAt;
      const publishAt = body.publishAt ? new Date(body.publishAt) : null;
      if (publishAt && publishAt <= now && !body.draft)
        throw errors.validation('Choose a future time or publish now.', {
          publishAt: ['Must be in the future'],
        });
      const status = body.draft ? 'draft' : publishAt ? 'scheduled' : 'published';
      const doc = await withTransaction(async (session) => {
        const [created] = await Announcement.create(
          [
            {
              orgId: a.orgId,
              courseId: body.courseId,
              authorId: a.userId,
              title: body.title,
              body: body.body,
              audience: body.audience,
              status,
              publishAt,
              publishedAt: status === 'published' ? now : null,
              expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
              sendEmail: body.sendEmail,
              requireAck: body.requireAck,
            },
          ],
          { session },
        );
        if (!created) throw new Error('announcement creation failed');
        if (status === 'published') {
          await enqueue(
            'announcement.published',
            { announcementId: created._id.toString() },
            { session, dedupeKey: `announcement.published:${created._id.toString()}` },
          );
        }
        return created.toObject() as AnnouncementDoc;
      });
      await audit({
        req,
        action: 'announcement.created',
        targetType: 'announcement',
        targetId: doc._id,
        metadata: { status, audience: body.audience, courseId: body.courseId },
      });
      return (await serialize(a, [doc], new Set([doc._id.toString()])))[0];
    },
  });

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/announcements/:id',
    summary: 'Announcement details (marks nothing as read)',
    tags,
    access: 'org',
    params: P.orgId,
    handler: async ({ req, params }) => {
      const a = actor(req);
      if (!isValidId(params.id)) throw errors.notFound('Announcement');
      const ann = await Announcement.findOne({ _id: params.id, orgId: a.orgId }).lean<AnnouncementDoc>();
      if (!ann) throw errors.notFound('Announcement');
      const manage = await canManage(a, ann);
      if (!manage) {
        const visible = await Announcement.exists({
          ...(await visibleFilter(a, req.receivedAt)),
          _id: ann._id,
        });
        if (!visible) throw errors.notFound('Announcement');
      }
      return (await serialize(a, [ann], manage ? new Set([ann._id.toString()]) : new Set()))[0];
    },
  });

  route(r, {
    method: 'patch',
    path: '/orgs/:orgId/announcements/:id',
    summary: 'Edit an announcement (edits are recorded in its history)',
    tags,
    access: 'org',
    params: P.orgId,
    body: updateAnnouncementSchema,
    handler: async ({ req, params, body }) => {
      const a = actor(req);
      const ann = await loadForManage(a, params.id);
      if (ann.status === 'archived')
        throw errors.conflict('Archived announcements cannot be edited.', 'archived');
      if (ann.rev !== body.expectedRev) throw errors.staleRevision();
      const { expectedRev, ...changes } = body;
      const set: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(changes))
        if (v !== undefined)
          set[k] = (k === 'publishAt' || k === 'expiresAt') && v ? new Date(v as string) : v;
      if (set.publishAt && ann.status === 'published') delete set.publishAt;
      if (set.publishAt instanceof Date && set.publishAt <= req.receivedAt)
        throw errors.validation('Choose a future time.', { publishAt: ['Must be in the future'] });
      if (ann.status === 'draft' && set.publishAt instanceof Date) set.status = 'draft';
      if (ann.status === 'scheduled' && set.publishAt === null) set.status = 'draft';
      const updated = await Announcement.findOneAndUpdate(
        { _id: ann._id, rev: expectedRev },
        {
          $set: set,
          $inc: { rev: 1 },
          $push: {
            history: {
              $each: [{ at: req.receivedAt, actorId: toId(a.userId), fields: Object.keys(set) }],
              $slice: -50,
            },
          },
        },
        { returnDocument: 'after' },
      ).lean<AnnouncementDoc>();
      if (!updated) throw errors.staleRevision();
      await audit({
        req,
        action: 'announcement.updated',
        targetType: 'announcement',
        targetId: ann._id,
        metadata: { fields: Object.keys(set) },
      });
      return (await serialize(a, [updated], new Set([updated._id.toString()])))[0];
    },
  });

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/announcements/:id/publish',
    summary: 'Publish a draft or scheduled announcement now',
    tags,
    access: 'org',
    status: 200,
    params: P.orgId,
    handler: async ({ req, params }) => {
      const a = actor(req);
      const ann = await loadForManage(a, params.id);
      const doc = await withTransaction(async (session) => {
        const updated = await Announcement.findOneAndUpdate(
          { _id: ann._id, status: { $in: ['draft', 'scheduled'] } },
          { $set: { status: 'published', publishedAt: req.receivedAt, publishAt: null }, $inc: { rev: 1 } },
          { returnDocument: 'after', session },
        ).lean<AnnouncementDoc>();
        if (!updated)
          throw errors.conflict('This announcement is already published or archived.', 'invalid_state');
        await enqueue(
          'announcement.published',
          { announcementId: updated._id.toString() },
          { session, dedupeKey: `announcement.published:${updated._id.toString()}` },
        );
        return updated;
      });
      await audit({ req, action: 'announcement.published', targetType: 'announcement', targetId: ann._id });
      return (await serialize(a, [doc], new Set([doc._id.toString()])))[0];
    },
  });

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/announcements/:id/archive',
    summary: 'Archive an announcement (hidden from recipients)',
    tags,
    access: 'org',
    status: 200,
    params: P.orgId,
    handler: async ({ req, params }) => {
      const a = actor(req);
      const ann = await loadForManage(a, params.id);
      const doc = await Announcement.findOneAndUpdate(
        { _id: ann._id, status: { $ne: 'archived' } },
        { $set: { status: 'archived' }, $inc: { rev: 1 } },
        { returnDocument: 'after' },
      ).lean<AnnouncementDoc>();
      if (!doc) throw errors.conflict('Already archived.', 'invalid_state');
      await audit({ req, action: 'announcement.archived', targetType: 'announcement', targetId: ann._id });
      return (await serialize(a, [doc], new Set([doc._id.toString()])))[0];
    },
  });

  for (const kind of ['read', 'acknowledge'] as const) {
    route(r, {
      method: 'post',
      path: `/orgs/:orgId/announcements/:id/${kind}`,
      summary: kind === 'read' ? 'Mark as read' : 'Acknowledge (for announcements that require it)',
      tags,
      access: 'org',
      status: 204,
      params: P.orgId,
      handler: async ({ req, params }) => {
        const a = actor(req);
        if (!isValidId(params.id)) throw errors.notFound('Announcement');
        const visible = await Announcement.exists({
          ...(await visibleFilter(a, req.receivedAt)),
          _id: toId(params.id),
        });
        if (!visible) throw errors.notFound('Announcement');
        const now = req.receivedAt;
        const key = { announcementId: toId(params.id), userId: toId(a.userId) };
        await AnnouncementReceipt.updateOne(
          key,
          { $setOnInsert: { readAt: now, acknowledgedAt: kind === 'acknowledge' ? now : null } },
          { upsert: true },
        );
        await AnnouncementReceipt.updateOne({ ...key, readAt: null }, { $set: { readAt: now } });
        if (kind === 'acknowledge')
          await AnnouncementReceipt.updateOne(
            { ...key, acknowledgedAt: null },
            { $set: { acknowledgedAt: now } },
          );
      },
    });
  }

  return r;
}
