import { Router } from 'express';
import { z } from 'zod';
import {
  addEnrollmentSchema,
  createCourseSchema,
  listCoursesQuerySchema,
  rosterImportSchema,
  rosterQuerySchema,
  sectionSchema,
  updateCourseSchema,
  updateEnrollmentSchema,
  updateSectionSchema,
  type SectionDTO,
} from '@sat/shared';
import { isDuplicateKeyError, withTransaction } from '../../db/connection';
import { sendCsv, toCsv } from '../../lib/csv';
import { errors } from '../../lib/errors';
import { paginate, searchRegex, skipFor, toSort } from '../../lib/pagination';
import { requireOrg } from '../../lib/request';
import { P, route } from '../../lib/route';
import { limits } from '../../middleware/rateLimit';
import {
  Course,
  Department,
  Enrollment,
  Membership,
  Section,
  User,
  toId,
  type CourseDoc,
  type EnrollmentDoc,
  type Id,
  type MembershipDoc,
  type SectionDoc,
} from '../../models';
import {
  actor,
  isOrgAdmin,
  loadCourseAccess,
  myCourseIds,
  requireCourseManager,
} from '../../services/access';
import { audit } from '../../services/audit';
import { createInvitation, serializeInvitation } from '../orgs/routes';
import { loadPeople } from '../common/serializers';
import {
  analyseRoster,
  commitRoster,
  enrollMember,
  serializeCourses,
  serializeEnrollments,
  summarize,
} from './service';

const tags = ['Courses'];

export function courseRoutes(): Router {
  const r = Router();

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/courses',
    summary: 'List courses (mine, or all for administrators)',
    tags,
    access: 'org',
    params: P.org,
    query: listCoursesQuerySchema,
    handler: async ({ req, query }) => {
      const a = actor(req);
      const filter: Record<string, unknown> = { orgId: a.orgId };
      if (query.scope === 'all') {
        if (!isOrgAdmin(a)) throw errors.forbidden();
      } else {
        const ids = [...(await myCourseIds(a, 'instructor')), ...(await myCourseIds(a, 'student'))];
        filter._id = { $in: ids };
      }
      filter.status = query.status ?? 'active';
      if (query.departmentId) filter.departmentId = query.departmentId;
      if (query.term) filter.term = query.term;
      const rx = searchRegex(query.q);
      if (rx) filter.$or = [{ code: rx }, { title: rx }];
      const [items, total] = await Promise.all([
        Course.find(filter)
          .sort(toSort(query.sort))
          .skip(skipFor(query.page, query.pageSize))
          .limit(query.pageSize)
          .lean<CourseDoc[]>(),
        Course.countDocuments(filter),
      ]);
      return paginate(await serializeCourses(items, a.userId), total, query.page, query.pageSize);
    },
  });

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/courses',
    summary:
      'Create a course (administrators; teachers when the organization allows it — they become instructor)',
    tags,
    access: 'org',
    orgRoles: ['org_admin', 'teacher'],
    params: P.org,
    body: createCourseSchema,
    handler: async ({ req, body }) => {
      const a = actor(req);
      const org = requireOrg(req).org;
      if (a.orgRole === 'teacher' && !org.settings.teachersCanCreateCourses) {
        throw errors.forbidden('Your organization only allows administrators to create courses.');
      }
      if (
        body.departmentId &&
        !(await Department.exists({ _id: body.departmentId, orgId: a.orgId, status: 'active' }))
      )
        throw errors.notFound('Department');
      const instructorIds = new Set<string>(a.orgRole === 'teacher' ? [a.userId] : []);
      for (const id of body.instructorIds ?? []) {
        if (!isOrgAdmin(a) && id !== a.userId)
          throw errors.forbidden('Only administrators can assign other instructors.');
        instructorIds.add(id);
      }
      const staff = await Membership.find({
        orgId: a.orgId,
        userId: { $in: [...instructorIds] },
        status: 'active',
        role: { $in: ['teacher', 'org_admin'] },
      }).lean<MembershipDoc[]>();
      if (staff.length !== instructorIds.size) {
        throw errors.validation('Every instructor must be an active teacher or administrator.', {
          instructorIds: ['Invalid instructor'],
        });
      }
      try {
        const course = await withTransaction(async (session) => {
          const [created] = await Course.create(
            [
              {
                orgId: a.orgId,
                departmentId: body.departmentId ?? null,
                code: body.code,
                title: body.title,
                description: body.description,
                term: body.term,
                createdBy: a.userId,
              },
            ],
            { session },
          );
          if (!created) throw new Error('course creation failed');
          const now = new Date();
          if (instructorIds.size > 0) {
            await Enrollment.insertMany(
              [...instructorIds].map((userId) => ({
                orgId: a.orgId,
                courseId: created._id,
                userId,
                role: 'instructor',
                status: 'active',
                enrolledAt: now,
              })),
              { session },
            );
          }
          await audit({
            req,
            action: 'course.created',
            targetType: 'course',
            targetId: created._id,
            metadata: { code: body.code, term: body.term },
            session,
          });
          return created.toObject() as CourseDoc;
        });
        const [dto] = await serializeCourses([course], a.userId);
        return dto;
      } catch (err) {
        if (isDuplicateKeyError(err))
          throw errors.conflict('A course with this code already exists for that term.', 'duplicate', {
            code: ['Already in use for this term'],
          });
        throw err;
      }
    },
  });

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/courses/:courseId',
    summary: 'Course details',
    tags,
    access: 'org',
    params: P.orgCourse,
    handler: async ({ req, params }) => {
      const a = actor(req);
      const { course } = await loadCourseAccess(a, params.courseId);
      const [dto] = await serializeCourses([course], a.userId);
      return dto;
    },
  });

  route(r, {
    method: 'patch',
    path: '/orgs/:orgId/courses/:courseId',
    summary: 'Update course details',
    tags,
    access: 'org',
    params: P.orgCourse,
    body: updateCourseSchema,
    handler: async ({ req, params, body }) => {
      const a = actor(req);
      await requireCourseManager(a, params.courseId, { write: true });
      if (body.departmentId && !(await Department.exists({ _id: body.departmentId, orgId: a.orgId })))
        throw errors.notFound('Department');
      try {
        const course = await Course.findOneAndUpdate(
          { _id: params.courseId, orgId: a.orgId },
          { $set: body },
          { returnDocument: 'after', runValidators: true },
        ).lean<CourseDoc>();
        if (!course) throw errors.notFound('Course');
        await audit({
          req,
          action: 'course.updated',
          targetType: 'course',
          targetId: course._id,
          metadata: { fields: Object.keys(body) },
        });
        const [dto] = await serializeCourses([course], a.userId);
        return dto;
      } catch (err) {
        if (isDuplicateKeyError(err))
          throw errors.conflict('A course with this code already exists for that term.', 'duplicate', {
            code: ['Already in use'],
          });
        throw err;
      }
    },
  });

  for (const action of ['archive', 'restore'] as const) {
    route(r, {
      method: 'post',
      path: `/orgs/:orgId/courses/:courseId/${action}`,
      summary:
        action === 'archive' ? 'Archive a course (read-only; data retained)' : 'Restore an archived course',
      tags,
      access: 'org',
      status: 200,
      params: P.orgCourse,
      handler: async ({ req, params }) => {
        const a = actor(req);
        await requireCourseManager(a, params.courseId);
        const course = await Course.findOneAndUpdate(
          { _id: params.courseId, orgId: a.orgId, status: action === 'archive' ? 'active' : 'archived' },
          {
            $set:
              action === 'archive'
                ? { status: 'archived', archivedAt: new Date() }
                : { status: 'active', archivedAt: null },
          },
          { returnDocument: 'after' },
        ).lean<CourseDoc>();
        if (!course)
          throw errors.conflict(
            `The course is already ${action === 'archive' ? 'archived' : 'active'}.`,
            'invalid_state',
          );
        await audit({ req, action: `course.${action}d`, targetType: 'course', targetId: course._id });
        const [dto] = await serializeCourses([course], a.userId);
        return dto;
      },
    });
  }

  /* ───────────── sections ───────────── */

  const sectionDto = (s: SectionDoc, count: number): SectionDTO => ({
    id: s._id.toString(),
    courseId: s.courseId.toString(),
    name: s.name,
    status: s.status,
    studentCount: count,
  });

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/courses/:courseId/sections',
    summary: 'List sections',
    tags: ['Sections'],
    access: 'org',
    params: P.orgCourse,
    handler: async ({ req, params }) => {
      const a = actor(req);
      const access = await loadCourseAccess(a, params.courseId);
      const sections = await Section.find({ courseId: access.course._id })
        .sort({ name: 1 })
        .lean<SectionDoc[]>();
      const counts = await Enrollment.aggregate<{ _id: Id; n: number }>([
        {
          $match: {
            courseId: access.course._id,
            role: 'student',
            status: 'active',
            sectionId: { $ne: null },
          },
        },
        { $group: { _id: '$sectionId', n: { $sum: 1 } } },
      ]);
      const byId = new Map(counts.map((c) => [c._id.toString(), c.n]));
      return sections.map((s) => sectionDto(s, access.canManage ? (byId.get(s._id.toString()) ?? 0) : 0));
    },
  });

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/courses/:courseId/sections',
    summary: 'Create a section',
    tags: ['Sections'],
    access: 'org',
    params: P.orgCourse,
    body: sectionSchema,
    handler: async ({ req, params, body }) => {
      const a = actor(req);
      const { course } = await requireCourseManager(a, params.courseId, { write: true });
      try {
        const s = await Section.create({ orgId: a.orgId, courseId: course._id, name: body.name });
        await audit({
          req,
          action: 'section.created',
          targetType: 'section',
          targetId: s._id,
          metadata: { courseId: course._id, name: body.name },
        });
        return sectionDto(s.toObject() as SectionDoc, 0);
      } catch (err) {
        if (isDuplicateKeyError(err))
          throw errors.conflict('A section with this name already exists.', 'duplicate', {
            name: ['Already exists'],
          });
        throw err;
      }
    },
  });

  route(r, {
    method: 'patch',
    path: '/orgs/:orgId/courses/:courseId/sections/:id',
    summary: 'Rename or archive a section',
    tags: ['Sections'],
    access: 'org',
    params: P.orgCourseId,
    body: updateSectionSchema,
    handler: async ({ req, params, body }) => {
      const a = actor(req);
      const { course } = await requireCourseManager(a, params.courseId, { write: true });
      try {
        const s = await Section.findOneAndUpdate(
          { _id: params.id, courseId: course._id },
          { $set: body },
          { returnDocument: 'after' },
        ).lean<SectionDoc>();
        if (!s) throw errors.notFound('Section');
        await audit({
          req,
          action: 'section.updated',
          targetType: 'section',
          targetId: s._id,
          metadata: body,
        });
        return sectionDto(
          s,
          await Enrollment.countDocuments({
            courseId: course._id,
            sectionId: s._id,
            status: 'active',
            role: 'student',
          }),
        );
      } catch (err) {
        if (isDuplicateKeyError(err))
          throw errors.conflict('A section with this name already exists.', 'duplicate', {
            name: ['Already exists'],
          });
        throw err;
      }
    },
  });

  /* ───────────── roster / enrollments ───────────── */

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/courses/:courseId/roster',
    summary: 'Course roster (instructors and administrators)',
    tags: ['Enrollment'],
    access: 'org',
    params: P.orgCourse,
    query: rosterQuerySchema,
    handler: async ({ req, params, query }) => {
      const a = actor(req);
      const { course } = await requireCourseManager(a, params.courseId);
      const match: Record<string, unknown> = { courseId: course._id, status: query.status };
      if (query.role) match.role = query.role;
      if (query.sectionId) match.sectionId = toId(query.sectionId);
      const rx = searchRegex(query.q);
      const desc = query.sort.startsWith('-');
      const field = query.sort.replace('-', '');
      const sortField = field === 'name' ? 'u.name' : field === 'email' ? 'u.email' : 'enrolledAt';
      const [result] = await Enrollment.aggregate<{ items: EnrollmentDoc[]; total: { n: number }[] }>([
        { $match: match },
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'u',
            pipeline: [{ $project: { name: 1, email: 1 } }],
          },
        },
        { $unwind: '$u' },
        ...(rx ? [{ $match: { $or: [{ 'u.name': rx }, { 'u.email': rx }] } }] : []),
        { $sort: { [sortField]: desc ? -1 : 1, _id: 1 } },
        {
          $facet: {
            items: [
              { $skip: skipFor(query.page, query.pageSize) },
              { $limit: query.pageSize },
              { $project: { u: 0 } },
            ],
            total: [{ $count: 'n' }],
          },
        },
      ]);
      return paginate(
        await serializeEnrollments(result?.items ?? [], a.orgId),
        result?.total[0]?.n ?? 0,
        query.page,
        query.pageSize,
      );
    },
  });

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/courses/:courseId/enrollments',
    summary: 'Enroll a member by id, or invite by email (unknown emails receive an invitation)',
    tags: ['Enrollment'],
    access: 'org',
    orgRoles: ['org_admin', 'teacher'],
    params: P.orgCourse,
    body: addEnrollmentSchema,
    handler: async ({ req, res, params, body }) => {
      const a = actor(req);
      const { course } = await requireCourseManager(a, params.courseId, { write: true });
      // Instructors may add co-instructors who are already staff; enrollMember rejects student members as
      // instructors, so enrollment can never be used to escalate privileges.
      let userId = body.userId;
      if (!userId && body.email) {
        const user = await User.findOne({ email: body.email }).select({ _id: 1 }).lean<{ _id: Id }>();
        const active = user
          ? await Membership.exists({ orgId: a.orgId, userId: user._id, status: 'active' })
          : null;
        if (!user || !active) {
          if (body.role === 'instructor')
            throw errors.validation('Instructors must already be members of the organization.', {
              email: ['Not a member'],
            });
          const inv = await createInvitation(req, {
            email: body.email,
            role: 'student',
            courseId: course._id.toString(),
          });
          res.status(202);
          return { invited: true, invitation: serializeInvitation(inv, await loadPeople([inv.invitedBy])) };
        }
        userId = user._id.toString();
      }
      if (!userId) throw errors.validation('Provide a user or email.');
      const enrollment = await enrollMember(req, a, course, userId, body.role, body.sectionId ?? null);
      const [dto] = await serializeEnrollments([enrollment], a.orgId);
      return { invited: false, enrollment: dto };
    },
  });

  route(r, {
    method: 'patch',
    path: '/orgs/:orgId/courses/:courseId/enrollments/:id',
    summary: 'Change section or drop/re-activate an enrollment',
    tags: ['Enrollment'],
    access: 'org',
    params: P.orgCourseId,
    body: updateEnrollmentSchema,
    handler: async ({ req, params, body }) => {
      const a = actor(req);
      const { course } = await requireCourseManager(a, params.courseId, { write: true });
      const existing = await Enrollment.findOne({
        _id: params.id,
        courseId: course._id,
      }).lean<EnrollmentDoc>();
      if (!existing) throw errors.notFound('Enrollment');
      if (body.sectionId && !(await Section.exists({ _id: body.sectionId, courseId: course._id })))
        throw errors.notFound('Section');
      if (
        existing.userId.toString() === a.userId &&
        body.status === 'dropped' &&
        existing.role === 'instructor' &&
        !isOrgAdmin(a)
      ) {
        const others = await Enrollment.countDocuments({
          courseId: course._id,
          role: 'instructor',
          status: 'active',
          _id: { $ne: existing._id },
        });
        if (others === 0)
          throw errors.conflict('A course must keep at least one instructor.', 'last_instructor');
      }
      const set: Record<string, unknown> = {};
      if (body.sectionId !== undefined) set.sectionId = body.sectionId;
      if (body.status) {
        set.status = body.status;
        set.droppedAt = body.status === 'dropped' ? new Date() : null;
      }
      const updated = await Enrollment.findOneAndUpdate(
        { _id: params.id, courseId: course._id },
        { $set: set },
        { returnDocument: 'after' },
      ).lean<EnrollmentDoc>();
      if (!updated) throw errors.notFound('Enrollment');
      await audit({
        req,
        action: 'enrollment.updated',
        targetType: 'enrollment',
        targetId: params.id,
        metadata: { courseId: course._id, userId: existing.userId, ...set },
      });
      const [dto] = await serializeEnrollments([updated], a.orgId);
      return dto;
    },
  });

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/courses/:courseId/roster-import/preview',
    summary: 'Validate a roster CSV (email,name,role,section) and preview the outcome — nothing is written',
    tags: ['Enrollment'],
    access: 'org',
    orgRoles: ['org_admin', 'teacher'],
    status: 200,
    params: P.orgCourse,
    body: rosterImportSchema,
    middleware: [limits.expensive()],
    handler: async ({ req, params, body }) => {
      const a = actor(req);
      if (!requireOrg(req).org.settings.csvImportEnabled)
        throw errors.forbidden('CSV import is disabled for this organization.');
      const { course } = await requireCourseManager(a, params.courseId, { write: true });
      const { rows, contentHash } = await analyseRoster(a, course, body.csv);
      return { rows, summary: summarize(rows), contentHash };
    },
  });

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/courses/:courseId/roster-import/commit',
    summary: 'Apply a previewed roster CSV (fails if the file changed or has errors)',
    tags: ['Enrollment'],
    access: 'org',
    orgRoles: ['org_admin', 'teacher'],
    status: 200,
    params: P.orgCourse,
    body: rosterImportSchema.extend({ contentHash: z.string().regex(/^[a-f0-9]{64}$/) }),
    middleware: [limits.expensive()],
    handler: async ({ req, params, body }) => {
      const a = actor(req);
      if (!requireOrg(req).org.settings.csvImportEnabled)
        throw errors.forbidden('CSV import is disabled for this organization.');
      const { course } = await requireCourseManager(a, params.courseId, { write: true });
      return commitRoster(req, a, course, body.csv, body.contentHash);
    },
  });

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/courses/:courseId/roster.csv',
    summary: 'Export the roster as CSV',
    tags: ['Enrollment'],
    access: 'org',
    params: P.orgCourse,
    responseContentType: 'text/csv',
    middleware: [limits.export()],
    handler: async ({ req, res, params }) => {
      const a = actor(req);
      const { course } = await requireCourseManager(a, params.courseId);
      const rows = await Enrollment.find({ courseId: course._id, status: 'active' })
        .limit(10_000)
        .lean<EnrollmentDoc[]>();
      const dtos = await serializeEnrollments(rows, a.orgId);
      dtos.sort((x, y) => x.role.localeCompare(y.role) || x.name.localeCompare(y.name));
      await audit({
        req,
        action: 'roster.exported',
        targetType: 'course',
        targetId: course._id,
        metadata: { rows: dtos.length },
      });
      sendCsv(
        res,
        `${course.code}-${course.term}-roster.csv`,
        toCsv(
          ['name', 'email', 'role', 'section', 'student_number', 'enrolled_at'],
          dtos.map((d) => [
            d.name,
            d.email,
            d.role,
            d.sectionName ?? '',
            d.studentNumber ?? '',
            d.enrolledAt,
          ]),
        ),
      );
    },
  });

  return r;
}
