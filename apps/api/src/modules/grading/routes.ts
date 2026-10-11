import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import type { ClientSession } from 'mongoose';
import { Router } from 'express';
import {
  adminAccessQuerySchema,
  bulkPublishSchema,
  canGrade,
  canReturnForRevision,
  computeFinalScore,
  displayStatus,
  evaluateSubmissionTiming,
  inboxQuerySchema,
  listRubricsQuerySchema,
  paginationQuerySchema,
  publishGradeSchema,
  returnForRevisionSchema,
  rubricMaxPoints,
  rubricSchema,
  saveGradeSchema,
  updateRubricSchema,
  validateGrade,
  type GradeHistoryDTO,
  type InboxRowDTO,
  type RubricCriterion,
  type RubricDTO,
  type TeacherGradeDTO,
  type TeacherSubmissionDTO,
} from '@sat/shared';
import { withTransaction } from '../../db/connection';
import { errors } from '../../lib/errors';
import { paginate, searchRegex, skipFor } from '../../lib/pagination';
import { P, route } from '../../lib/route';
import {
  Assignment,
  Enrollment,
  Grade,
  GradeHistory,
  Membership,
  Rubric,
  Section,
  Submission,
  SubmissionVersion,
  User,
  isValidId,
  toId,
  type AssignmentDoc,
  type EnrollmentDoc,
  type GradeContent,
  type GradeDoc,
  type GradeHistoryDoc,
  type Id,
  type MembershipDoc,
  type RubricDoc,
  type SectionDoc,
  type SubmissionDoc,
  type SubmissionVersionDoc,
  type UserDoc,
} from '../../models';
import {
  actor,
  isOrgAdmin,
  loadAssignmentAccess,
  myCourseIds,
  requireAssignmentInstructor,
  requireOrgAdmin,
  type Actor,
} from '../../services/access';
import { audit } from '../../services/audit';
import { isGradeVisible } from '../../services/gradeVisibility';
import { enqueue } from '../../services/outbox';
import { loadPeople, personRef } from '../common/serializers';
import { approvedExtensions, recipientIds } from '../assignments/service';
import { loadVersions, teacherGradeContentDto } from '../submissions/service';

const tags = ['Grading'];

export function serializeTeacherGrade(
  grade: GradeDoc | null,
  assignment: AssignmentDoc,
): TeacherGradeDTO | null {
  if (!grade) return null;
  return {
    id: grade._id.toString(),
    rev: grade.rev,
    draft: teacherGradeContentDto(grade.draft),
    published: teacherGradeContentDto(grade.published),
    publishedAt: grade.publishedAt?.toISOString() ?? null,
    hasUnpublishedChanges: grade.draft != null,
    visibleToStudent: isGradeVisible(grade, assignment),
  };
}

async function rubricFor(assignment: AssignmentDoc): Promise<RubricCriterion[] | null> {
  if (!assignment.rubricId) return null;
  const rubric = await Rubric.findOne({
    _id: assignment.rubricId,
    orgId: assignment.orgId,
  }).lean<RubricDoc>();
  return rubric
    ? rubric.criteria.map((c) => ({
        id: c.id,
        title: c.title,
        description: c.description ?? '',
        maxPoints: c.maxPoints,
        levels: c.levels,
      }))
    : null;
}

/** Loads a submission and requires the caller to be an instructor of its course (tenant-scoped). */
async function loadForGrading(a: Actor, submissionId: string, opts: { write?: boolean } = {}) {
  if (!isValidId(submissionId)) throw errors.notFound('Submission');
  const submission = await Submission.findOne({ _id: submissionId, orgId: a.orgId }).lean<SubmissionDoc>();
  if (!submission) throw errors.notFound('Submission');
  const access = await requireAssignmentInstructor(a, submission.assignmentId.toString(), opts).catch(() => {
    throw errors.notFound('Submission');
  });
  return { submission, ...access };
}

async function buildInbox(assignment: AssignmentDoc, now: Date): Promise<InboxRowDTO[]> {
  const targeted = await recipientIds(assignment);
  const subs = await Submission.find({ assignmentId: assignment._id }).lean<SubmissionDoc[]>();
  const studentIds = [
    ...new Map([...targeted, ...subs.map((s) => s.studentId)].map((id) => [id.toString(), id])).values(),
  ];
  const [users, enrollments, memberships, grades, exts] = await Promise.all([
    User.find({ _id: { $in: studentIds } })
      .select({ name: 1, email: 1 })
      .lean<UserDoc[]>(),
    Enrollment.find({ courseId: assignment.courseId, userId: { $in: studentIds } }).lean<EnrollmentDoc[]>(),
    Membership.find({ orgId: assignment.orgId, userId: { $in: studentIds } })
      .select({ userId: 1, studentNumber: 1 })
      .lean<MembershipDoc[]>(),
    Grade.find({ assignmentId: assignment._id }).lean<GradeDoc[]>(),
    approvedExtensions([assignment._id], studentIds),
  ]);
  const sections = await Section.find({
    _id: { $in: enrollments.map((e) => e.sectionId).filter(Boolean) },
  }).lean<SectionDoc[]>();
  const by = <T extends { _id: Id }>(rows: T[]) => new Map(rows.map((r) => [r._id.toString(), r]));
  const userBy = by(users);
  const sectionBy = by(sections);
  const enrollBy = new Map(enrollments.map((e) => [e.userId.toString(), e]));
  const memberBy = new Map(memberships.map((m) => [m.userId.toString(), m]));
  const subBy = new Map(subs.map((s) => [s.studentId.toString(), s]));
  const gradeBy = new Map(grades.map((g) => [g.studentId.toString(), g]));

  return studentIds.map((id) => {
    const key = id.toString();
    const sub = subBy.get(key);
    const grade = gradeBy.get(key);
    const ext = exts.get(`${assignment._id.toString()}:${key}`) ?? null;
    const timing = evaluateSubmissionTiming(assignment, now, ext);
    const enrollment = enrollBy.get(key);
    return {
      studentId: key,
      name: userBy.get(key)?.name ?? 'Unknown student',
      email: userBy.get(key)?.email ?? '',
      studentNumber: memberBy.get(key)?.studentNumber ?? null,
      sectionName: enrollment?.sectionId
        ? (sectionBy.get(enrollment.sectionId.toString())?.name ?? null)
        : null,
      submissionId: sub && sub.state !== 'draft' ? sub._id.toString() : null,
      state: sub?.state === 'draft' ? null : (sub?.state ?? null),
      displayStatus: displayStatus({
        state: sub?.state === 'draft' ? null : (sub?.state ?? null),
        isLate: sub?.isLate ?? false,
        attemptCount: sub?.attemptCount ?? 0,
        gradeVisible: true,
        now,
        effectiveDueAt: timing.effectiveDueAt,
        stillAccepting: timing.allowed,
      }),
      submittedAt: sub?.lastSubmittedAt?.toISOString() ?? null,
      isLate: sub?.isLate ?? false,
      attemptCount: sub?.attemptCount ?? 0,
      gradeStatus: grade?.draft ? 'draft' : grade?.published ? 'published' : 'none',
      finalPoints: grade?.draft?.finalPoints ?? grade?.published?.finalPoints ?? null,
      extensionDueAt: ext?.toISOString() ?? null,
    };
  });
}

function filterInbox(rows: InboxRowDTO[], status: string): InboxRowDTO[] {
  const submitted = (r: InboxRowDTO) =>
    r.state === 'submitted' || r.state === 'graded' || r.state === 'returned';
  switch (status) {
    case 'submitted':
      return rows.filter(submitted);
    case 'late':
      return rows.filter((r) => submitted(r) && r.isLate);
    case 'needs_grading':
      return rows.filter((r) => r.state === 'submitted' && r.gradeStatus !== 'published');
    case 'graded':
      return rows.filter((r) => r.gradeStatus === 'published');
    case 'returned':
      return rows.filter((r) => r.state === 'returned');
    case 'missing':
      return rows.filter((r) => r.displayStatus === 'missing');
    case 'not_submitted':
      return rows.filter((r) => !submitted(r));
    default:
      return rows;
  }
}

function sortInbox(rows: InboxRowDTO[], sort: string): InboxRowDTO[] {
  const desc = sort.startsWith('-');
  const field = sort.replace('-', '');
  const val = (r: InboxRowDTO) =>
    field === 'name' ? r.name.toLowerCase() : field === 'status' ? r.displayStatus : (r.submittedAt ?? '');
  return [...rows].sort((x, y) => {
    const cmp = val(x) < val(y) ? -1 : val(x) > val(y) ? 1 : x.studentId.localeCompare(y.studentId);
    return desc ? -cmp : cmp;
  });
}

async function buildTeacherSubmission(
  submission: SubmissionDoc,
  assignment: AssignmentDoc,
  now: Date,
): Promise<TeacherSubmissionDTO> {
  const [student, membership, grade, versions, rubric, ext, siblings] = await Promise.all([
    User.findById(submission.studentId).select({ name: 1, email: 1 }).lean<UserDoc>(),
    Membership.findOne({ orgId: submission.orgId, userId: submission.studentId }).lean<MembershipDoc>(),
    Grade.findOne({ submissionId: submission._id }).lean<GradeDoc>(),
    loadVersions(submission._id),
    rubricFor(assignment),
    approvedExtensions([assignment._id], [submission.studentId]),
    Submission.aggregate<{ _id: Id; name: string }>([
      { $match: { assignmentId: assignment._id, state: { $in: ['submitted', 'graded', 'returned'] } } },
      {
        $lookup: {
          from: 'users',
          localField: 'studentId',
          foreignField: '_id',
          as: 'u',
          pipeline: [{ $project: { name: 1 } }],
        },
      },
      { $project: { name: { $toLower: { $ifNull: [{ $arrayElemAt: ['$u.name', 0] }, ''] } } } },
      { $sort: { name: 1, _id: 1 } },
    ]),
  ]);
  const extDue = ext.get(`${assignment._id.toString()}:${submission.studentId.toString()}`) ?? null;
  const timing = evaluateSubmissionTiming(assignment, now, extDue);
  const index = siblings.findIndex((s) => s._id.equals(submission._id));
  return {
    id: submission._id.toString(),
    assignment: {
      id: assignment._id.toString(),
      title: assignment.title,
      courseId: assignment.courseId.toString(),
      courseCode: '',
      maxPoints: assignment.maxPoints,
      rubricId: assignment.rubricId?.toString() ?? null,
      dueAt: assignment.dueAt.toISOString(),
      latePolicy: {
        mode: assignment.latePolicy.mode,
        penaltyPercentPerDay: assignment.latePolicy.penaltyPercentPerDay,
        maxLateDays: assignment.latePolicy.maxLateDays ?? null,
      },
      gradeRelease: assignment.gradeRelease,
    },
    student: {
      id: submission.studentId.toString(),
      name: student?.name ?? 'Unknown',
      email: student?.email ?? '',
      studentNumber: membership?.studentNumber ?? null,
    },
    state: submission.state,
    displayStatus: displayStatus({
      state: submission.state,
      isLate: submission.isLate,
      attemptCount: submission.attemptCount,
      gradeVisible: true,
      now,
      effectiveDueAt: timing.effectiveDueAt,
      stillAccepting: timing.allowed,
    }),
    rev: submission.rev,
    attemptCount: submission.attemptCount,
    returnFeedback: submission.returnFeedback,
    versions,
    grade: serializeTeacherGrade(grade, assignment),
    rubric,
    extensionDueAt: extDue?.toISOString() ?? null,
    previousId: index > 0 ? (siblings[index - 1]?._id.toString() ?? null) : null,
    nextId: index >= 0 && index < siblings.length - 1 ? (siblings[index + 1]?._id.toString() ?? null) : null,
  };
}

async function withCourseCode(dto: TeacherSubmissionDTO, courseCode: string): Promise<TeacherSubmissionDTO> {
  return { ...dto, assignment: { ...dto.assignment, courseCode } };
}

async function publishGrade(
  req: Request,
  a: Actor,
  grade: GradeDoc,
  assignment: AssignmentDoc,
  reason: string | null,
  session: ClientSession,
) {
  if (!grade.draft)
    throw errors.conflict('There are no unpublished changes to publish.', 'nothing_to_publish');
  const correcting = grade.published != null;
  if (correcting && !reason)
    throw errors.validation(
      'Explain why this published grade is being changed.',
      { reason: ['Required when correcting a published grade'] },
      'reason_required',
    );
  const now = req.receivedAt;
  const updated = await Grade.findOneAndUpdate(
    { _id: grade._id, rev: grade.rev },
    {
      $set: { published: grade.draft, draft: null, publishedAt: now, publishedBy: a.userId },
      $inc: { rev: 1 },
    },
    { returnDocument: 'after', session },
  ).lean<GradeDoc>();
  if (!updated) throw errors.staleRevision();
  await Submission.updateOne(
    { _id: grade.submissionId, state: { $in: ['submitted', 'graded'] } },
    { $set: { state: 'graded' }, $inc: { rev: 1 } },
    { session },
  );
  await GradeHistory.create(
    [
      {
        orgId: grade.orgId,
        gradeId: grade._id,
        submissionId: grade.submissionId,
        assignmentId: grade.assignmentId,
        action: correcting ? 'correct' : 'publish',
        actorId: a.userId,
        previousFinalPoints: grade.published?.finalPoints ?? null,
        newFinalPoints: grade.draft.finalPoints,
        reason,
        versionId: grade.draft.versionId,
      },
    ],
    { session },
  );
  if (isGradeVisible(updated, assignment)) {
    await enqueue(
      'grade.published',
      { gradeId: grade._id.toString(), correction: correcting, publishedAt: now.getTime() },
      { session, dedupeKey: `grade.published:${grade._id.toString()}:${now.getTime()}` },
    );
  }
  await audit({
    req,
    action: correcting ? 'grade.corrected' : 'grade.published',
    targetType: 'submission',
    targetId: grade.submissionId,
    metadata: { previous: grade.published?.finalPoints ?? null, next: grade.draft.finalPoints, reason },
    session,
  });
  return updated;
}

const serializeRubric = (r: RubricDoc, people: Awaited<ReturnType<typeof loadPeople>>): RubricDTO => ({
  id: r._id.toString(),
  title: r.title,
  description: r.description,
  courseId: r.courseId?.toString() ?? null,
  criteria: r.criteria.map((c) => ({
    id: c.id,
    title: c.title,
    description: c.description ?? '',
    maxPoints: c.maxPoints,
    levels: c.levels.map((l) => ({ title: l.title, points: l.points, description: l.description ?? '' })),
  })),
  totalPoints: rubricMaxPoints(r.criteria),
  status: r.status,
  owner: personRef(people, r.ownerId),
  rev: r.rev,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export function gradingRoutes(): Router {
  const r = Router();

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/assignments/:assignmentId/submissions',
    summary: 'Submission inbox: every recipient with status, lateness and grade state',
    tags,
    access: 'org',
    params: P.orgAssignment,
    query: inboxQuerySchema,
    handler: async ({ req, params, query }) => {
      const { assignment } = await requireAssignmentInstructor(actor(req), params.assignmentId);
      let rows = await buildInbox(assignment, req.receivedAt);
      if (query.sectionId) {
        const section = await Section.findOne({
          _id: query.sectionId,
          courseId: assignment.courseId,
        }).lean<SectionDoc>();
        rows = rows.filter((x) => x.sectionName === section?.name);
      }
      const rx = searchRegex(query.q);
      if (rx)
        rows = rows.filter(
          (x) => rx.test(x.name) || rx.test(x.email) || (x.studentNumber != null && rx.test(x.studentNumber)),
        );
      rows = sortInbox(filterInbox(rows, query.status), query.sort);
      const start = skipFor(query.page, query.pageSize);
      return paginate(rows.slice(start, start + query.pageSize), rows.length, query.page, query.pageSize);
    },
  });

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/submissions/:submissionId',
    summary: 'A student submission with all versions and the grading record (instructors)',
    tags,
    access: 'org',
    params: P.orgSubmission,
    handler: async ({ req, params }) => {
      const a = actor(req);
      const { submission, assignment, course } = await loadForGrading(a, params.submissionId);
      if (submission.state === 'draft') throw errors.notFound('Submission');
      return withCourseCode(
        await buildTeacherSubmission(submission, assignment, req.receivedAt),
        course.code,
      );
    },
  });

  route(r, {
    method: 'put',
    path: '/orgs/:orgId/submissions/:submissionId/grade',
    summary: 'Save a grading draft (not visible to the student until published)',
    tags,
    access: 'org',
    params: P.orgSubmission,
    body: saveGradeSchema,
    handler: async ({ req, params, body }) => {
      const a = actor(req);
      const { submission, assignment } = await loadForGrading(a, params.submissionId, { write: true });
      if (!canGrade(submission.state))
        throw errors.conflict('Only submitted work can be graded.', 'not_gradable');
      const rubric = await rubricFor(assignment);
      const validation = validateGrade({
        maxPoints: assignment.maxPoints,
        points: body.points,
        rubric,
        rubricScores: body.rubricScores,
      });
      if (!validation.ok) throw errors.validation('Check the scores.', validation.errors, 'invalid_grade');
      const version = submission.currentVersionId
        ? await SubmissionVersion.findById(submission.currentVersionId).lean<SubmissionVersionDoc>()
        : null;
      const score = computeFinalScore(
        validation.rawPoints,
        assignment.maxPoints,
        version?.lateByMinutes ?? 0,
        assignment.latePolicy,
      );
      const content: GradeContent = {
        rawPoints: score.rawPoints,
        latePenaltyPoints: score.latePenaltyPoints,
        finalPoints: score.finalPoints,
        maxPoints: assignment.maxPoints,
        feedback: body.feedback,
        privateNotes: body.privateNotes,
        rubricScores: rubric
          ? (body.rubricScores ?? []).map((s) => ({
              criterionId: s.criterionId,
              points: s.points,
              comment: s.comment ?? '',
            }))
          : [],
        rubric,
        versionId: version?._id ?? null,
        gradedBy: toId(a.userId),
        gradedAt: req.receivedAt,
      };
      const existing = await Grade.findOne({ submissionId: submission._id }).lean<GradeDoc>();
      let grade: GradeDoc | null;
      if (existing) {
        if (body.expectedRev != null && body.expectedRev !== existing.rev) throw errors.staleRevision();
        grade = await Grade.findOneAndUpdate(
          { _id: existing._id, rev: existing.rev },
          { $set: { draft: content }, $inc: { rev: 1 } },
          { returnDocument: 'after' },
        ).lean<GradeDoc>();
        if (!grade) throw errors.staleRevision();
      } else {
        try {
          grade = (
            await Grade.create({
              orgId: a.orgId,
              courseId: assignment.courseId,
              assignmentId: assignment._id,
              submissionId: submission._id,
              studentId: submission.studentId,
              draft: content,
            })
          ).toObject() as GradeDoc;
        } catch (err) {
          if ((err as { code?: number }).code === 11000) throw errors.staleRevision();
          throw err;
        }
      }
      await audit({
        req,
        action: 'grade.draft_saved',
        targetType: 'submission',
        targetId: submission._id,
        metadata: { finalPoints: content.finalPoints },
      });
      return serializeTeacherGrade(grade, assignment);
    },
  });

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/submissions/:submissionId/grade/publish',
    summary: 'Publish the grading draft (a reason is required when correcting a published grade)',
    tags,
    access: 'org',
    status: 200,
    params: P.orgSubmission,
    body: publishGradeSchema,
    handler: async ({ req, params, body }) => {
      const a = actor(req);
      const { submission, assignment } = await loadForGrading(a, params.submissionId, { write: true });
      const grade = await Grade.findOne({ submissionId: submission._id }).lean<GradeDoc>();
      if (!grade) throw errors.conflict('Save a grade before publishing.', 'nothing_to_publish');
      if (body.expectedRev != null && body.expectedRev !== grade.rev) throw errors.staleRevision();
      if (!canGrade(submission.state))
        throw errors.conflict(
          'Only submitted work can be graded. The student has been asked to revise this work.',
          'not_gradable',
        );
      const updated = await withTransaction((session) =>
        publishGrade(req, a, grade, assignment, body.reason ?? null, session),
      );
      return serializeTeacherGrade(updated, assignment);
    },
  });

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/submissions/:submissionId/return',
    summary: 'Return work to the student for revision (grants one more attempt)',
    tags,
    access: 'org',
    status: 200,
    params: P.orgSubmission,
    body: returnForRevisionSchema,
    handler: async ({ req, params, body }) => {
      const a = actor(req);
      const { submission, assignment, course } = await loadForGrading(a, params.submissionId, {
        write: true,
      });
      if (!canReturnForRevision(submission.state))
        throw errors.conflict('Only submitted or graded work can be returned.', 'invalid_state');
      if (body.expectedRev != null && body.expectedRev !== submission.rev) throw errors.staleRevision();
      await withTransaction(async (session) => {
        const updated = await Submission.updateOne(
          { _id: submission._id, rev: submission.rev },
          {
            $set: { state: 'returned', returnFeedback: body.feedback, returnedAt: req.receivedAt },
            $inc: { rev: 1 },
          },
          { session },
        );
        if (updated.modifiedCount !== 1) throw errors.staleRevision();
        await GradeHistory.create(
          [
            {
              orgId: submission.orgId,
              submissionId: submission._id,
              assignmentId: assignment._id,
              action: 'return',
              actorId: a.userId,
              reason: body.feedback.slice(0, 1000),
              versionId: submission.currentVersionId,
            },
          ],
          { session },
        );
        await enqueue(
          'submission.returned',
          { submissionId: submission._id.toString() },
          {
            session,
            dedupeKey: `submission.returned:${submission._id.toString()}:${req.receivedAt.getTime()}`,
          },
        );
      });
      await audit({ req, action: 'submission.returned', targetType: 'submission', targetId: submission._id });
      const fresh = await Submission.findById(submission._id).lean<SubmissionDoc>();
      return withCourseCode(
        await buildTeacherSubmission(fresh as SubmissionDoc, assignment, req.receivedAt),
        course.code,
      );
    },
  });

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/submissions/:submissionId/grade-history',
    summary: 'Grade publication, correction and return history',
    tags,
    access: 'org',
    params: P.orgSubmission,
    handler: async ({ req, params }): Promise<GradeHistoryDTO[]> => {
      const a = actor(req);
      const { submission } = await loadForGrading(a, params.submissionId);
      const rows = await GradeHistory.find({ submissionId: submission._id })
        .sort({ createdAt: -1 })
        .limit(200)
        .lean<GradeHistoryDoc[]>();
      const people = await loadPeople(rows.map((h) => h.actorId));
      return rows.map((h) => ({
        id: h._id.toString(),
        action: h.action,
        actor: personRef(people, h.actorId),
        previousFinalPoints: h.previousFinalPoints,
        newFinalPoints: h.newFinalPoints,
        reason: h.reason,
        versionId: h.versionId?.toString() ?? null,
        createdAt: h.createdAt.toISOString(),
      }));
    },
  });

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/assignments/:assignmentId/grades/publish-all',
    summary:
      'Bulk-publish first-time grading drafts (corrections must be published individually with a reason)',
    tags,
    access: 'org',
    status: 200,
    params: P.orgAssignment,
    body: bulkPublishSchema,
    handler: async ({ req, params, body }) => {
      const a = actor(req);
      const { assignment } = await requireAssignmentInstructor(a, params.assignmentId, { write: true });
      // Every record is constrained to this assignment, so ids from other assignments/tenants are ignored.
      const filter: Record<string, unknown> = {
        assignmentId: assignment._id,
        draft: { $ne: null },
        published: null,
      };
      if (body.submissionIds) filter.submissionId = { $in: body.submissionIds };
      const grades = await Grade.find(filter).limit(500).lean<GradeDoc[]>();
      let published = 0;
      const skipped: string[] = [];
      for (const grade of grades) {
        const sub = await Submission.findById(grade.submissionId).select({ state: 1 }).lean<SubmissionDoc>();
        if (!canGrade(sub?.state ?? null)) {
          skipped.push(grade.submissionId.toString());
          continue;
        }
        try {
          await withTransaction((session) => publishGrade(req, a, grade, assignment, null, session));
          published += 1;
        } catch {
          skipped.push(grade.submissionId.toString());
        }
      }
      await audit({
        req,
        action: 'grade.bulk_published',
        targetType: 'assignment',
        targetId: assignment._id,
        metadata: { published, skipped: skipped.length },
      });
      return { published, skipped };
    },
  });

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/assignments/:assignmentId/grades/release',
    summary: 'Release held grades to students (assignments with gradeRelease = hold)',
    tags,
    access: 'org',
    status: 200,
    params: P.orgAssignment,
    handler: async ({ req, params }) => {
      const a = actor(req);
      const { assignment } = await requireAssignmentInstructor(a, params.assignmentId, { write: true });
      if (assignment.gradeRelease !== 'hold')
        throw errors.conflict(
          'Grades for this assignment are released as soon as they are published.',
          'not_held',
        );
      if (assignment.gradesReleasedAt) return { releasedAt: assignment.gradesReleasedAt.toISOString() };
      const now = req.receivedAt;
      await withTransaction(async (session) => {
        const res = await Assignment.updateOne(
          { _id: assignment._id, gradesReleasedAt: null },
          { $set: { gradesReleasedAt: now }, $inc: { rev: 1 } },
          { session },
        );
        if (res.modifiedCount === 1)
          await enqueue(
            'grades.released',
            { assignmentId: assignment._id.toString() },
            { session, dedupeKey: `grades.released:${assignment._id.toString()}` },
          );
      });
      await audit({ req, action: 'grade.released', targetType: 'assignment', targetId: assignment._id });
      return { releasedAt: now.toISOString() };
    },
  });

  /* ───────────── break-glass administrative access ───────────── */

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/admin/submissions/:submissionId',
    summary: 'Administrator read access to a submission and its grade — requires a reason and is audited',
    tags: ['Administration'],
    access: 'org',
    orgRoles: ['org_admin'],
    params: P.orgSubmission,
    query: adminAccessQuerySchema,
    handler: async ({ req, params, query }) => {
      const a = actor(req);
      requireOrgAdmin(a);
      const submission = await Submission.findOne({
        _id: params.submissionId,
        orgId: a.orgId,
      }).lean<SubmissionDoc>();
      if (!submission) throw errors.notFound('Submission');
      const assignment = await Assignment.findById(submission.assignmentId).lean<AssignmentDoc>();
      if (!assignment) throw errors.notFound('Submission');
      await audit({
        req,
        action: 'admin.submission_accessed',
        targetType: 'submission',
        targetId: submission._id,
        metadata: { reason: query.reason, studentId: submission.studentId },
      });
      return buildTeacherSubmission(submission, assignment, req.receivedAt);
    },
  });

  /* ───────────── rubrics ───────────── */

  const rubricFilterFor = async (a: Actor): Promise<Record<string, unknown>> => {
    if (isOrgAdmin(a)) return { orgId: a.orgId };
    const taught = await myCourseIds(a, 'instructor');
    return { orgId: a.orgId, $or: [{ ownerId: a.userId }, { courseId: { $in: taught } }] };
  };

  const loadRubric = async (a: Actor, id: string, write = false): Promise<RubricDoc> => {
    if (!isValidId(id)) throw errors.notFound('Rubric');
    const rubric = await Rubric.findOne({ _id: id, ...(await rubricFilterFor(a)) }).lean<RubricDoc>();
    if (!rubric) throw errors.notFound('Rubric');
    if (write && rubric.ownerId.toString() !== a.userId && !isOrgAdmin(a))
      throw errors.forbidden('Only the rubric owner can change it.');
    return rubric;
  };

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/rubrics',
    summary: 'Rubrics available to me',
    tags: ['Rubrics'],
    access: 'org',
    orgRoles: ['teacher', 'org_admin'],
    params: P.org,
    query: listRubricsQuerySchema,
    handler: async ({ req, query }) => {
      const a = actor(req);
      const filter = await rubricFilterFor(a);
      if (!query.includeArchived) filter.status = 'active';
      if (query.courseId) filter.courseId = query.courseId;
      const rx = searchRegex(query.q);
      if (rx) filter.title = rx;
      const [rows, total] = await Promise.all([
        Rubric.find(filter)
          .sort({ updatedAt: -1, _id: -1 })
          .skip(skipFor(query.page, query.pageSize))
          .limit(query.pageSize)
          .lean<RubricDoc[]>(),
        Rubric.countDocuments(filter),
      ]);
      const people = await loadPeople(rows.map((x) => x.ownerId));
      return paginate(
        rows.map((x) => serializeRubric(x, people)),
        total,
        query.page,
        query.pageSize,
      );
    },
  });

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/rubrics',
    summary: 'Create a reusable rubric',
    tags: ['Rubrics'],
    access: 'org',
    orgRoles: ['teacher', 'org_admin'],
    params: P.org,
    body: rubricSchema,
    handler: async ({ req, body }) => {
      const a = actor(req);
      if (body.courseId) {
        const taught = await myCourseIds(a, 'instructor');
        if (!isOrgAdmin(a) && !taught.some((c) => c.toString() === body.courseId))
          throw errors.notFound('Course');
      }
      const criteria = body.criteria.map((c) => ({ ...c, id: c.id ?? randomUUID().slice(0, 8) }));
      if (new Set(criteria.map((c) => c.id)).size !== criteria.length)
        throw errors.validation('Criterion ids must be unique.');
      const rubric = await Rubric.create({
        orgId: a.orgId,
        ownerId: a.userId,
        courseId: body.courseId,
        title: body.title,
        description: body.description,
        criteria,
      });
      await audit({ req, action: 'rubric.created', targetType: 'rubric', targetId: rubric._id });
      return serializeRubric(rubric.toObject() as RubricDoc, await loadPeople([rubric.ownerId]));
    },
  });

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/rubrics/:id',
    summary: 'Rubric details (instructors; students see rubrics through assignments they can view)',
    tags: ['Rubrics'],
    access: 'org',
    params: P.orgId,
    handler: async ({ req, params }) => {
      const a = actor(req);
      if (a.orgRole === 'student') {
        // Students may read a rubric attached to a published assignment they receive.
        const assignments = await Assignment.find({
          orgId: a.orgId,
          rubricId: params.id,
          status: { $in: ['published', 'closed'] },
        })
          .select({ _id: 1 })
          .limit(20)
          .lean<AssignmentDoc[]>();
        let allowed = false;
        for (const asg of assignments) {
          try {
            if ((await loadAssignmentAccess(a, asg._id.toString())).isRecipient) {
              allowed = true;
              break;
            }
          } catch {
            /* not a recipient of this one */
          }
        }
        const rubric = allowed
          ? await Rubric.findOne({ _id: params.id, orgId: a.orgId }).lean<RubricDoc>()
          : null;
        if (!rubric) throw errors.notFound('Rubric');
        return serializeRubric(rubric, await loadPeople([rubric.ownerId]));
      }
      const rubric = await loadRubric(a, params.id);
      return serializeRubric(rubric, await loadPeople([rubric.ownerId]));
    },
  });

  route(r, {
    method: 'patch',
    path: '/orgs/:orgId/rubrics/:id',
    summary: 'Edit or archive a rubric (criteria are locked once used for grading)',
    tags: ['Rubrics'],
    access: 'org',
    orgRoles: ['teacher', 'org_admin'],
    params: P.orgId,
    body: updateRubricSchema,
    handler: async ({ req, params, body }) => {
      const a = actor(req);
      const rubric = await loadRubric(a, params.id, true);
      if (rubric.rev !== body.expectedRev) throw errors.staleRevision();
      const { expectedRev, ...changes } = body;
      if (changes.criteria) {
        const used = await Assignment.find({ rubricId: rubric._id })
          .select({ _id: 1, title: 1, maxPoints: 1, status: 1 })
          .lean<AssignmentDoc[]>();
        if (used.length && (await Grade.exists({ assignmentId: { $in: used.map((u) => u._id) } }))) {
          throw errors.conflict(
            'This rubric has been used for grading. Duplicate it to make changes; past grades keep their rubric snapshot.',
            'rubric_in_use',
          );
        }
        // Assignments score as the rubric total, so it must keep matching the points of every assignment using it.
        const total = rubricMaxPoints(changes.criteria);
        const mismatched = used.filter((u) => u.status !== 'archived' && u.maxPoints !== total);
        if (mismatched.length) {
          throw errors.conflict(
            `This rubric would total ${total} points, but ${mismatched.map((u) => `"${u.title}" is worth ${u.maxPoints}`).join(', ')}. Change the assignment points first, or duplicate the rubric.`,
            'rubric_points_mismatch',
          );
        }
      }
      const set: Record<string, unknown> = { ...changes };
      if (changes.criteria)
        set.criteria = changes.criteria.map((c) => ({ ...c, id: c.id ?? randomUUID().slice(0, 8) }));
      const updated = await Rubric.findOneAndUpdate(
        { _id: rubric._id, rev: expectedRev },
        { $set: set, $inc: { rev: 1 } },
        { returnDocument: 'after' },
      ).lean<RubricDoc>();
      if (!updated) throw errors.staleRevision();
      await audit({
        req,
        action: 'rubric.updated',
        targetType: 'rubric',
        targetId: rubric._id,
        metadata: { fields: Object.keys(changes) },
      });
      return serializeRubric(updated, await loadPeople([updated.ownerId]));
    },
  });

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/assignments/:assignmentId/grade-history',
    summary: 'All grade events for an assignment',
    tags,
    access: 'org',
    params: P.orgAssignment,
    query: paginationQuerySchema,
    handler: async ({ req, params, query }) => {
      const { assignment } = await requireAssignmentInstructor(actor(req), params.assignmentId);
      const filter = { assignmentId: assignment._id };
      const [rows, total] = await Promise.all([
        GradeHistory.find(filter)
          .sort({ createdAt: -1 })
          .skip(skipFor(query.page, query.pageSize))
          .limit(query.pageSize)
          .lean<GradeHistoryDoc[]>(),
        GradeHistory.countDocuments(filter),
      ]);
      const people = await loadPeople(rows.map((h) => h.actorId));
      return paginate(
        rows.map((h) => ({
          id: h._id.toString(),
          action: h.action,
          actor: personRef(people, h.actorId),
          previousFinalPoints: h.previousFinalPoints,
          newFinalPoints: h.newFinalPoints,
          reason: h.reason,
          versionId: h.versionId?.toString() ?? null,
          createdAt: h.createdAt.toISOString(),
          submissionId: h.submissionId.toString(),
        })),
        total,
        query.page,
        query.pageSize,
      );
    },
  });

  return r;
}
