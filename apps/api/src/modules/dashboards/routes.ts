import { Router } from 'express';
import type {
  AdminDashboardDTO,
  AssignmentDTO,
  AssignmentListItemDTO,
  CourseReportDTO,
  StudentDashboardDTO,
  TeacherDashboardDTO,
} from '@sat/shared';
import { sendCsv, toCsv } from '../../lib/csv';
import { P, route } from '../../lib/route';
import { limits } from '../../middleware/rateLimit';
import {
  Assignment,
  AuditLog,
  Course,
  Enrollment,
  ExtensionRequest,
  Grade,
  Invitation,
  Membership,
  Submission,
  SubmissionVersion,
  User,
  toId,
  type AssignmentDoc,
  type CourseDoc,
  type EnrollmentDoc,
  type GradeDoc,
  type Id,
  type SubmissionDoc,
  type UserDoc,
} from '../../models';
import { actor, myCourseIds, requireCourseInstructor, requireOrgAdmin } from '../../services/access';
import { audit } from '../../services/audit';
import { serializeAnnouncementsForDashboard } from './announcementsFeed';
import { recipientIds, studentVisibleAssignments } from '../assignments/service';
import { requireOrg } from '../../lib/request';

const DAY = 86_400_000;
const SUBMITTED = new Set(['submitted', 'late', 'resubmitted', 'graded', 'returned']);

const listItem = (d: AssignmentDTO): AssignmentListItemDTO => ({
  id: d.id,
  title: d.title,
  courseId: d.courseId,
  courseCode: d.courseCode,
  dueAt: d.dueAt,
  effectiveDueAt: d.my?.effectiveDueAt ?? d.dueAt,
  status: d.status,
  displayStatus: d.my?.displayStatus ?? null,
  maxPoints: d.maxPoints,
  finalPoints: d.my?.finalPoints ?? null,
});

export function dashboardRoutes(): Router {
  const r = Router();
  const tags = ['Dashboards & reports'];

  /**
   * Student metrics:
   *  - dueSoon:   not yet submitted, effective deadline within the next 7 days.
   *  - pending:   not started / draft / withdrawn / overdue-but-accepting.
   *  - submitted: submitted, late or resubmitted and awaiting a released grade.
   *  - overdue:   past the effective deadline and not submitted (overdue + missing).
   */
  route(r, {
    method: 'get',
    path: '/orgs/:orgId/dashboard/student',
    summary: 'Student dashboard',
    tags,
    access: 'org',
    params: P.org,
    handler: async ({ req }): Promise<StudentDashboardDTO> => {
      const a = actor(req);
      const now = req.receivedAt;
      const [all, courseIds, announcements] = await Promise.all([
        studentVisibleAssignments(a, now),
        myCourseIds(a, 'student'),
        serializeAnnouncementsForDashboard(a, now, 5),
      ]);
      const status = (d: AssignmentDTO) => d.my?.displayStatus ?? 'not_started';
      const due = (d: AssignmentDTO) => new Date(d.my?.effectiveDueAt ?? d.dueAt).getTime();
      const open = (d: AssignmentDTO) => ['not_started', 'draft', 'withdrawn'].includes(status(d));
      const upcoming = all.filter((d) => open(d) && due(d) >= now.getTime()).sort((x, y) => due(x) - due(y));
      const overdue = all.filter((d) => ['overdue', 'missing'].includes(status(d)));
      const graded = all.filter((d) => status(d) === 'graded');
      const grades = await Grade.find({
        assignmentId: { $in: graded.map((g) => toId(g.id)) },
        studentId: toId(a.userId),
      })
        .select({ assignmentId: 1, publishedAt: 1 })
        .lean<GradeDoc[]>();
      const gradedAt = new Map(grades.map((g) => [g.assignmentId.toString(), g.publishedAt?.getTime() ?? 0]));
      const courses = await Course.find({ _id: { $in: courseIds }, status: 'active' }).lean<CourseDoc[]>();
      return {
        activeCourses: courses.length,
        counts: {
          dueSoon: upcoming.filter((d) => due(d) <= now.getTime() + 7 * DAY).length,
          pending: all.filter((d) => open(d) || status(d) === 'overdue').length,
          submitted: all.filter((d) => ['submitted', 'late', 'resubmitted'].includes(status(d))).length,
          overdue: overdue.length,
          returned: all.filter((d) => status(d) === 'returned').length,
          graded: graded.length,
        },
        upcoming: upcoming.slice(0, 8).map(listItem),
        overdue: overdue.slice(0, 8).map(listItem),
        recentlyGraded: [...graded]
          .sort((x, y) => (gradedAt.get(y.id) ?? 0) - (gradedAt.get(x.id) ?? 0))
          .slice(0, 5)
          .map(listItem),
        announcements,
        progressByCourse: courses.map((c) => {
          const mine = all.filter((d) => d.courseId === c._id.toString());
          const scored = mine.filter((d) => d.my?.finalPoints != null && d.maxPoints > 0);
          return {
            courseId: c._id.toString(),
            code: c.code,
            title: c.title,
            total: mine.length,
            completed: mine.filter((d) => SUBMITTED.has(status(d))).length,
            averagePercent: scored.length
              ? Math.round(
                  (scored.reduce((t, d) => t + (d.my?.finalPoints ?? 0) / d.maxPoints, 0) / scored.length) *
                    1000,
                ) / 10
              : null,
          };
        }),
      };
    },
  });

  /**
   * Teacher metrics (courses where the caller is an active instructor):
   *  - pendingGrading: submissions in state "submitted" (awaiting a published grade).
   *  - lateSubmissions: current versions flagged late (submitted/graded/returned).
   *  - missingSubmissions: for assignments due in the last 30 days that no longer accept work, targeted students without a submission.
   *  - completionRate: submitted ÷ targeted across published/closed assignments.
   */
  route(r, {
    method: 'get',
    path: '/orgs/:orgId/dashboard/teacher',
    summary: 'Teacher dashboard',
    tags,
    access: 'org',
    orgRoles: ['teacher', 'org_admin'],
    params: P.org,
    handler: async ({ req }): Promise<TeacherDashboardDTO> => {
      const a = actor(req);
      const now = req.receivedAt;
      const taught = await myCourseIds(a, 'instructor');
      const courses = await Course.find({ _id: { $in: taught }, status: 'active' }).lean<CourseDoc[]>();
      const courseIds = courses.map((c) => c._id);
      const code = new Map(courses.map((c) => [c._id.toString(), c.code]));
      const [statusCounts, pendingGrading, lateSubmissions, pendingExtensions, assignments, recent] =
        await Promise.all([
          Assignment.aggregate<{ _id: string; n: number }>([
            { $match: { courseId: { $in: courseIds } } },
            { $group: { _id: '$status', n: { $sum: 1 } } },
          ]),
          Submission.countDocuments({ courseId: { $in: courseIds }, state: 'submitted' }),
          Submission.countDocuments({
            courseId: { $in: courseIds },
            state: { $in: ['submitted', 'graded', 'returned'] },
            isLate: true,
          }),
          ExtensionRequest.countDocuments({ courseId: { $in: courseIds }, status: 'pending' }),
          Assignment.find({ courseId: { $in: courseIds }, status: { $in: ['published', 'closed'] } })
            .sort({ dueAt: 1 })
            .limit(500)
            .lean<AssignmentDoc[]>(),
          Submission.find({
            courseId: { $in: courseIds },
            state: { $in: ['submitted', 'graded', 'returned'] },
          })
            .sort({ lastSubmittedAt: -1 })
            .limit(10)
            .lean<SubmissionDoc[]>(),
        ]);
      const count = (s: string) => statusCounts.find((x) => x._id === s)?.n ?? 0;
      const assignmentIds = assignments.map((x) => x._id);
      const [subCounts, gradeCounts, enrollments] = await Promise.all([
        Submission.aggregate<{ _id: Id; n: number }>([
          {
            $match: {
              assignmentId: { $in: assignmentIds },
              state: { $in: ['submitted', 'graded', 'returned'] },
            },
          },
          { $group: { _id: '$assignmentId', n: { $sum: 1 } } },
        ]),
        Grade.aggregate<{ _id: Id; draft: number; published: number }>([
          { $match: { assignmentId: { $in: assignmentIds } } },
          {
            $group: {
              _id: '$assignmentId',
              draft: { $sum: { $cond: [{ $ne: ['$draft', null] }, 1, 0] } },
              published: { $sum: { $cond: [{ $ne: ['$published', null] }, 1, 0] } },
            },
          },
        ]),
        Enrollment.find({ courseId: { $in: courseIds }, role: 'student', status: 'active' })
          .select({ courseId: 1, sectionId: 1 })
          .lean<EnrollmentDoc[]>(),
      ]);
      const submittedBy = new Map(subCounts.map((x) => [x._id.toString(), x.n]));
      const gradesBy = new Map(gradeCounts.map((x) => [x._id.toString(), x]));
      const targetedCount = (asg: AssignmentDoc) =>
        enrollments.filter(
          (e) =>
            e.courseId.equals(asg.courseId) &&
            (asg.sectionIds.length === 0 ||
              (e.sectionId != null && asg.sectionIds.some((s) => s.equals(e.sectionId as Id)))),
        ).length;

      let missing = 0;
      for (const asg of assignments) {
        const closedForAll =
          asg.status === 'closed' ||
          (asg.availableUntil != null && asg.availableUntil < now) ||
          (asg.latePolicy.mode === 'reject' &&
            asg.dueAt.getTime() + asg.gracePeriodMinutes * 60_000 < now.getTime());
        if (closedForAll && asg.dueAt.getTime() > now.getTime() - 30 * DAY)
          missing += Math.max(0, targetedCount(asg) - (submittedBy.get(asg._id.toString()) ?? 0));
      }
      const students = await User.find({ _id: { $in: recent.map((s) => s.studentId) } })
        .select({ name: 1 })
        .lean<UserDoc[]>();
      const studentName = new Map(students.map((u) => [u._id.toString(), u.name]));
      const titleOf = new Map(assignments.map((x) => [x._id.toString(), x]));
      const missingTitles = recent
        .filter((s) => !titleOf.has(s.assignmentId.toString()))
        .map((s) => s.assignmentId);
      if (missingTitles.length)
        for (const x of await Assignment.find({ _id: { $in: missingTitles } }).lean<AssignmentDoc[]>())
          titleOf.set(x._id.toString(), x);

      return {
        coursesTaught: courses.length,
        assignments: {
          active: count('published') + count('scheduled'),
          published: count('published'),
          scheduled: count('scheduled'),
          draft: count('draft'),
        },
        pendingGrading,
        lateSubmissions,
        missingSubmissions: missing,
        pendingExtensions,
        upcomingDeadlines: assignments
          .filter((x) => x.status === 'published' && x.dueAt >= now)
          .slice(0, 8)
          .map((x) => ({
            id: x._id.toString(),
            title: x.title,
            courseId: x.courseId.toString(),
            courseCode: code.get(x.courseId.toString()) ?? '',
            dueAt: x.dueAt.toISOString(),
            effectiveDueAt: x.dueAt.toISOString(),
            status: x.status,
            displayStatus: null,
            maxPoints: x.maxPoints,
            finalPoints: null,
            submitted: submittedBy.get(x._id.toString()) ?? 0,
            targeted: targetedCount(x),
          })),
        recentSubmissions: recent.map((s) => ({
          submissionId: s._id.toString(),
          assignmentId: s.assignmentId.toString(),
          assignmentTitle: titleOf.get(s.assignmentId.toString())?.title ?? '',
          courseCode: code.get(s.courseId.toString()) ?? '',
          studentName: studentName.get(s.studentId.toString()) ?? 'Student',
          submittedAt: (s.lastSubmittedAt ?? s.updatedAt).toISOString(),
          isLate: s.isLate,
        })),
        gradeRelease: assignments
          .filter((x) => gradesBy.has(x._id.toString()))
          .map((x) => ({
            assignmentId: x._id.toString(),
            title: x.title,
            courseCode: code.get(x.courseId.toString()) ?? '',
            draftGrades: gradesBy.get(x._id.toString())?.draft ?? 0,
            publishedGrades: gradesBy.get(x._id.toString())?.published ?? 0,
            held: x.gradeRelease === 'hold' && !x.gradesReleasedAt,
          }))
          .filter((x) => x.draftGrades > 0 || x.held)
          .slice(0, 10),
        courseCompletion: courses.map((c) => {
          const list = assignments.filter((x) => x.courseId.equals(c._id));
          const targeted = list.reduce((t, x) => t + targetedCount(x), 0);
          const submitted = list.reduce((t, x) => t + (submittedBy.get(x._id.toString()) ?? 0), 0);
          return {
            courseId: c._id.toString(),
            code: c.code,
            title: c.title,
            assignments: list.length,
            completionRate: targeted > 0 ? Math.round((submitted / targeted) * 1000) / 10 : null,
          };
        }),
      };
    },
  });

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/dashboard/admin',
    summary: 'Organization dashboard (aggregate counts only — no individual academic records)',
    tags,
    access: 'org',
    orgRoles: ['org_admin'],
    params: P.org,
    handler: async ({ req }): Promise<AdminDashboardDTO> => {
      const a = actor(req);
      requireOrgAdmin(a);
      const orgId = toId(a.orgId);
      const now = req.receivedAt;
      const tz = requireOrg(req).org.timezone;
      const since30 = new Date(now.getTime() - 30 * DAY);
      const [
        memberAgg,
        courseAgg,
        assignmentAgg,
        byDay,
        invitesPending,
        invitesExpired,
        invitesAccepted,
        adminAccess,
        memberIds,
      ] = await Promise.all([
        Membership.aggregate<{ _id: { role: string; status: string }; n: number }>([
          { $match: { orgId } },
          { $group: { _id: { role: '$role', status: '$status' }, n: { $sum: 1 } } },
        ]),
        Course.aggregate<{ _id: string; n: number }>([
          { $match: { orgId } },
          { $group: { _id: '$status', n: { $sum: 1 } } },
        ]),
        Assignment.aggregate<{ _id: string; n: number }>([
          { $match: { orgId } },
          { $group: { _id: '$status', n: { $sum: 1 } } },
        ]),
        SubmissionVersion.aggregate<{ _id: string; n: number }>([
          { $match: { orgId, submittedAt: { $gte: since30 } } },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$submittedAt', timezone: tz } },
              n: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ]),
        Invitation.countDocuments({ orgId, status: 'pending', expiresAt: { $gt: now } }),
        Invitation.countDocuments({
          orgId,
          $or: [{ status: 'expired' }, { status: 'pending', expiresAt: { $lte: now } }],
        }),
        Invitation.countDocuments({ orgId, status: 'accepted', acceptedAt: { $gte: since30 } }),
        AuditLog.countDocuments({
          orgId,
          action: { $in: ['admin.submission_accessed', 'admin.file_accessed'] },
          createdAt: { $gte: since30 },
        }),
        Membership.find({ orgId, status: { $in: ['active', 'suspended'] } })
          .limit(50_000)
          .distinct('userId'),
      ]);
      const [failedLogins, locked] = await Promise.all([
        AuditLog.countDocuments({
          action: { $in: ['auth.login.failed', 'auth.account.locked'] },
          actorId: { $in: memberIds },
          createdAt: { $gte: new Date(now.getTime() - DAY) },
        }),
        User.countDocuments({ _id: { $in: memberIds }, lockedUntil: { $gt: now } }),
      ]);
      const m = (pred: (k: { role: string; status: string }) => boolean) =>
        memberAgg.filter((x) => pred(x._id)).reduce((t, x) => t + x.n, 0);
      const c = (rows: { _id: string; n: number }[], s: string) => rows.find((x) => x._id === s)?.n ?? 0;
      const days = Array.from({ length: 30 }, (_, i) =>
        new Date(now.getTime() - (29 - i) * DAY).toLocaleDateString('en-CA', { timeZone: tz }),
      );
      const counts = new Map(byDay.map((x) => [x._id, x.n]));
      return {
        members: {
          total: m((k) => k.status === 'active'),
          students: m((k) => k.status === 'active' && k.role === 'student'),
          teachers: m((k) => k.status === 'active' && k.role === 'teacher'),
          admins: m((k) => k.status === 'active' && k.role === 'org_admin'),
          pending: m((k) => k.status === 'pending'),
          suspended: m((k) => k.status === 'suspended'),
        },
        courses: { active: c(courseAgg, 'active'), archived: c(courseAgg, 'archived') },
        assignments: {
          draft: c(assignmentAgg, 'draft'),
          scheduled: c(assignmentAgg, 'scheduled'),
          published: c(assignmentAgg, 'published'),
          closed: c(assignmentAgg, 'closed'),
        },
        submissionsByDay: days.map((date) => ({ date, count: counts.get(date) ?? 0 })),
        invitations: {
          pending: invitesPending,
          expired: invitesExpired,
          acceptedLast30Days: invitesAccepted,
        },
        security: {
          failedLoginsLast24h: failedLogins,
          lockedAccounts: locked,
          adminAccessEventsLast30Days: adminAccess,
        },
      };
    },
  });

  /* ───────────── course reports ───────────── */

  async function courseReport(
    courseId: string,
    a: ReturnType<typeof actor>,
    now: Date,
  ): Promise<CourseReportDTO> {
    const { course } = await requireCourseInstructor(a, courseId);
    const [assignments, enrollments] = await Promise.all([
      Assignment.find({ courseId: course._id, status: { $in: ['published', 'closed'] } })
        .sort({ dueAt: 1 })
        .limit(500)
        .lean<AssignmentDoc[]>(),
      Enrollment.find({ courseId: course._id, role: 'student', status: 'active' }).lean<EnrollmentDoc[]>(),
    ]);
    const studentIds = enrollments.map((e) => e.userId);
    const [subs, grades, users] = await Promise.all([
      Submission.find({
        assignmentId: { $in: assignments.map((x) => x._id) },
        studentId: { $in: studentIds },
      })
        .select({ assignmentId: 1, studentId: 1, state: 1, isLate: 1 })
        .lean<SubmissionDoc[]>(),
      Grade.find({ assignmentId: { $in: assignments.map((x) => x._id) }, published: { $ne: null } })
        .select({ assignmentId: 1, studentId: 1, published: 1 })
        .lean<GradeDoc[]>(),
      User.find({ _id: { $in: studentIds } })
        .select({ name: 1 })
        .lean<UserDoc[]>(),
    ]);
    const done = (s: SubmissionDoc) => ['submitted', 'graded', 'returned'].includes(s.state);
    const targetsOf = new Map<string, Set<string>>();
    for (const asg of assignments)
      targetsOf.set(asg._id.toString(), new Set((await recipientIds(asg)).map(String)));
    const pct = (g: GradeDoc) =>
      g.published && g.published.maxPoints > 0 ? g.published.finalPoints / g.published.maxPoints : null;
    const avg = (xs: (number | null)[]) => {
      const v = xs.filter((x): x is number => x != null);
      return v.length ? Math.round((v.reduce((t, x) => t + x, 0) / v.length) * 1000) / 10 : null;
    };
    return {
      course: { id: course._id.toString(), code: course.code, title: course.title, term: course.term },
      studentCount: studentIds.length,
      assignments: assignments.map((asg) => {
        const key = asg._id.toString();
        const targets = targetsOf.get(key) ?? new Set();
        const s = subs.filter(
          (x) => x.assignmentId.equals(asg._id) && targets.has(x.studentId.toString()) && done(x),
        );
        const g = grades.filter((x) => x.assignmentId.equals(asg._id));
        return {
          id: key,
          title: asg.title,
          dueAt: asg.dueAt.toISOString(),
          status: asg.status,
          maxPoints: asg.maxPoints,
          targeted: targets.size,
          submitted: s.length,
          late: s.filter((x) => x.isLate).length,
          graded: g.length,
          averagePercent: avg(g.map(pct)),
          completionRate: targets.size ? Math.round((s.length / targets.size) * 1000) / 10 : null,
        };
      }),
      students: users
        .map((u) => {
          const key = u._id.toString();
          const mine = subs.filter((x) => x.studentId.equals(u._id) && done(x));
          const targetedFor = assignments.filter((asg) => targetsOf.get(asg._id.toString())?.has(key));
          const pastDue = targetedFor.filter((asg) => asg.dueAt < now);
          return {
            studentId: key,
            name: u.name,
            submitted: mine.length,
            late: mine.filter((x) => x.isLate).length,
            missing: pastDue.filter((asg) => !mine.some((x) => x.assignmentId.equals(asg._id))).length,
            averagePercent: avg(grades.filter((g) => g.studentId.equals(u._id)).map(pct)),
          };
        })
        .sort((x, y) => x.name.localeCompare(y.name)),
    };
  }

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/courses/:courseId/report',
    summary: 'Course completion and grade report (instructors)',
    tags,
    access: 'org',
    params: P.orgCourse,
    middleware: [limits.expensive()],
    handler: ({ req, params }) => courseReport(params.courseId, actor(req), req.receivedAt),
  });

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/courses/:courseId/gradebook.csv',
    summary: 'Gradebook CSV of published grades (instructors)',
    tags,
    access: 'org',
    params: P.orgCourse,
    responseContentType: 'text/csv',
    middleware: [limits.export()],
    handler: async ({ req, res, params }) => {
      const a = actor(req);
      const { course } = await requireCourseInstructor(a, params.courseId);
      const assignments = await Assignment.find({
        courseId: course._id,
        status: { $in: ['published', 'closed'] },
      })
        .sort({ dueAt: 1 })
        .limit(500)
        .lean<AssignmentDoc[]>();
      const enrollments = await Enrollment.find({
        courseId: course._id,
        role: 'student',
        status: 'active',
      }).lean<EnrollmentDoc[]>();
      const [users, grades, memberships] = await Promise.all([
        User.find({ _id: { $in: enrollments.map((e) => e.userId) } })
          .select({ name: 1, email: 1 })
          .lean<UserDoc[]>(),
        Grade.find({ assignmentId: { $in: assignments.map((x) => x._id) }, published: { $ne: null } }).lean<
          GradeDoc[]
        >(),
        Membership.find({ orgId: a.orgId, userId: { $in: enrollments.map((e) => e.userId) } })
          .select({ userId: 1, studentNumber: 1 })
          .lean(),
      ]);
      const num = new Map(memberships.map((m) => [m.userId.toString(), m.studentNumber]));
      const rows = users
        .sort((x, y) => x.name.localeCompare(y.name))
        .map((u) => [
          u.name,
          u.email,
          num.get(u._id.toString()) ?? '',
          ...assignments.map(
            (asg) =>
              grades.find((g) => g.assignmentId.equals(asg._id) && g.studentId.equals(u._id))?.published
                ?.finalPoints ?? '',
          ),
        ]);
      await audit({
        req,
        action: 'gradebook.exported',
        targetType: 'course',
        targetId: course._id,
        metadata: { students: rows.length },
      });
      sendCsv(
        res,
        `${course.code}-gradebook.csv`,
        toCsv(
          ['name', 'email', 'student_number', ...assignments.map((x) => `${x.title} (/${x.maxPoints})`)],
          rows,
        ),
      );
    },
  });

  return r;
}
