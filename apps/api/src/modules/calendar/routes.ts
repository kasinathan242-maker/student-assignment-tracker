import type { Request } from 'express';
import { Router } from 'express';
import { calendarQuerySchema, type CalendarEventDTO } from '@sat/shared';
import { env } from '../../config/env';
import { buildIcs } from '../../lib/ics';
import { P, route } from '../../lib/route';
import { limits } from '../../middleware/rateLimit';
import { Assignment, Course, toId, type AssignmentDoc, type CourseDoc } from '../../models';
import { actor, isOrgAdmin, myCourseIds, type Actor } from '../../services/access';
import { studentVisibleAssignments } from '../assignments/service';

/**
 * Calendar events come from the same authorization path as assignment lists. For students, the date is
 * the *effective* deadline (approved extensions applied).
 */
async function events(
  a: Actor,
  req: Request,
  from: Date,
  to: Date,
  courseId?: string,
): Promise<CalendarEventDTO[]> {
  const out: CalendarEventDTO[] = [];
  const taught = await myCourseIds(a, 'instructor');
  if (taught.length > 0 || isOrgAdmin(a)) {
    const filter: Record<string, unknown> = {
      orgId: toId(a.orgId),
      courseId: { $in: taught },
      status: { $in: ['scheduled', 'published', 'closed'] },
      dueAt: { $gte: from, $lte: to },
    };
    if (courseId) filter.courseId = taught.find((c) => c.toString() === courseId) ?? null;
    const rows = await Assignment.find(filter).sort({ dueAt: 1 }).limit(1000).lean<AssignmentDoc[]>();
    const courses = await Course.find({ _id: { $in: rows.map((x) => x.courseId) } })
      .select({ code: 1 })
      .lean<CourseDoc[]>();
    const code = new Map(courses.map((c) => [c._id.toString(), c.code]));
    for (const x of rows) {
      out.push({
        id: `t-${x._id.toString()}`,
        assignmentId: x._id.toString(),
        title: x.title,
        courseId: x.courseId.toString(),
        courseCode: code.get(x.courseId.toString()) ?? '',
        type: x.type,
        dueAt: x.dueAt.toISOString(),
        isExtended: false,
        status: x.status,
      });
    }
  }
  const studying = await studentVisibleAssignments(
    a,
    req.receivedAt,
    courseId ? { courseId: toId(courseId) } : {},
  );
  for (const x of studying) {
    const due = new Date(x.my?.effectiveDueAt ?? x.dueAt);
    if (due < from || due > to) continue;
    out.push({
      id: `s-${x.id}`,
      assignmentId: x.id,
      title: x.title,
      courseId: x.courseId,
      courseCode: x.courseCode,
      type: x.type,
      dueAt: due.toISOString(),
      isExtended: Boolean(x.my?.extensionDueAt),
      status: x.my?.displayStatus ?? x.status,
    });
  }
  return out.sort((p, q) => p.dueAt.localeCompare(q.dueAt));
}

export function calendarRoutes(): Router {
  const r = Router();
  const tags = ['Calendar'];

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/calendar',
    summary: 'Deadline events in a date range (max 400 days)',
    tags,
    access: 'org',
    params: P.org,
    query: calendarQuerySchema,
    handler: ({ req, query }) =>
      events(actor(req), req, new Date(query.from), new Date(query.to), query.courseId),
  });

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/calendar.ics',
    summary: 'Download deadlines as an iCalendar file (one-time export; not a live subscription)',
    tags,
    access: 'org',
    params: P.org,
    responseContentType: 'text/calendar',
    middleware: [limits.export()],
    handler: async ({ req, res }) => {
      const a = actor(req);
      const now = req.receivedAt;
      const list = await events(
        a,
        req,
        new Date(now.getTime() - 30 * 86_400_000),
        new Date(now.getTime() + 365 * 86_400_000),
      );
      const ics = buildIcs(
        'Assignment deadlines',
        list.map((e) => ({
          uid: `${e.id}-${a.userId}@assignment-tracker`,
          start: new Date(e.dueAt),
          summary: `${e.courseCode}: ${e.title}${e.isExtended ? ' (extended)' : ''}`,
          url: new URL(`/o/${a.orgId}/assignments/${e.assignmentId}`, env().APP_URL).toString(),
        })),
        now,
      );
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="deadlines.ics"');
      res.send(ics);
    },
  });

  return r;
}
