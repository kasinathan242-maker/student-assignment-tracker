import {
  canSubmit,
  displayStatus,
  evaluateSubmissionTiming,
  type AssignmentDTO,
  type MySubmissionSummary,
} from '@sat/shared';
import {
  Assignment,
  Course,
  Enrollment,
  ExtensionRequest,
  Grade,
  Submission,
  toId,
  type AssignmentDoc,
  type CourseDoc,
  type EnrollmentDoc,
  type ExtensionRequestDoc,
  type GradeDoc,
  type Id,
  type SubmissionDoc,
} from '../../models';
import { isGradeVisible } from '../../services/gradeVisibility';
import { loadFiles, loadPeople, personRef } from '../common/serializers';

export interface StudentState {
  submission: SubmissionDoc | null;
  extensionDueAt: Date | null;
  pendingExtension: boolean;
  grade: GradeDoc | null;
}

/** Latest approved extension per (assignment, student). One query for any number of assignments. */
export async function approvedExtensions(assignmentIds: Id[], studentIds: Id[]): Promise<Map<string, Date>> {
  if (assignmentIds.length === 0 || studentIds.length === 0) return new Map();
  const rows = await ExtensionRequest.find({
    assignmentId: { $in: assignmentIds },
    studentId: { $in: studentIds },
    status: 'approved',
  })
    .sort({ decidedAt: 1 })
    .select({ assignmentId: 1, studentId: 1, approvedDueAt: 1 })
    .lean<Pick<ExtensionRequestDoc, 'assignmentId' | 'studentId' | 'approvedDueAt'>[]>();
  const map = new Map<string, Date>();
  for (const r of rows)
    if (r.approvedDueAt) map.set(`${r.assignmentId.toString()}:${r.studentId.toString()}`, r.approvedDueAt);
  return map;
}

export async function extensionDueAt(assignmentId: Id, studentId: Id | string): Promise<Date | null> {
  const map = await approvedExtensions([assignmentId], [toId(studentId)]);
  return map.get(`${assignmentId.toString()}:${studentId.toString()}`) ?? null;
}

export async function loadStudentStates(
  assignments: Pick<AssignmentDoc, '_id'>[],
  studentId: string,
): Promise<Map<string, StudentState>> {
  const ids = assignments.map((a) => a._id);
  const sid = toId(studentId);
  const [subs, exts, pending, grades] = await Promise.all([
    Submission.find({ assignmentId: { $in: ids }, studentId: sid }).lean<SubmissionDoc[]>(),
    approvedExtensions(ids, [sid]),
    ExtensionRequest.find({ assignmentId: { $in: ids }, studentId: sid, status: 'pending' })
      .select({ assignmentId: 1 })
      .lean<ExtensionRequestDoc[]>(),
    Grade.find({ assignmentId: { $in: ids }, studentId: sid }).lean<GradeDoc[]>(),
  ]);
  const subBy = new Map(subs.map((s) => [s.assignmentId.toString(), s]));
  const pendingSet = new Set(pending.map((p) => p.assignmentId.toString()));
  const gradeBy = new Map(grades.map((g) => [g.assignmentId.toString(), g]));
  const out = new Map<string, StudentState>();
  for (const id of ids) {
    const key = id.toString();
    out.set(key, {
      submission: subBy.get(key) ?? null,
      extensionDueAt: exts.get(`${key}:${studentId}`) ?? null,
      pendingExtension: pendingSet.has(key),
      grade: gradeBy.get(key) ?? null,
    });
  }
  return out;
}

export function mySummary(assignment: AssignmentDoc, state: StudentState, now: Date): MySubmissionSummary {
  const timing = evaluateSubmissionTiming(assignment, now, state.extensionDueAt);
  const sub = state.submission;
  const gradeVisible = isGradeVisible(state.grade, assignment);
  return {
    submissionState: sub?.state ?? null,
    displayStatus: displayStatus({
      state: sub?.state ?? null,
      isLate: sub?.isLate ?? false,
      attemptCount: sub?.attemptCount ?? 0,
      gradeVisible,
      now,
      effectiveDueAt: timing.effectiveDueAt,
      stillAccepting: timing.allowed,
    }),
    effectiveDueAt: timing.effectiveDueAt.toISOString(),
    extensionDueAt: state.extensionDueAt?.toISOString() ?? null,
    cutoffAt: timing.cutoffAt?.toISOString() ?? null,
    acceptingSubmissions: canSubmit({
      state: sub?.state ?? null,
      attemptCount: sub?.attemptCount ?? 0,
      resubmission: assignment.resubmission,
      timing,
    }).ok,
    isLate: sub?.isLate ?? false,
    attemptCount: sub?.attemptCount ?? 0,
    gradeVisible,
    finalPoints: gradeVisible ? (state.grade?.published?.finalPoints ?? null) : null,
    pendingExtensionRequest: state.pendingExtension,
  };
}

export interface SerializeContext {
  viewerId: string;
  /** Viewer is a student recipient → include `my` summary. */
  asStudent: boolean;
  canManage: boolean;
  now?: Date;
}

export async function serializeAssignments(
  docs: AssignmentDoc[],
  ctx: SerializeContext,
): Promise<AssignmentDTO[]> {
  if (docs.length === 0) return [];
  const now = ctx.now ?? new Date();
  const courseIds = [...new Set(docs.map((d) => d.courseId.toString()))];
  const [courses, files, people, states, teaching] = await Promise.all([
    Course.find({ _id: { $in: courseIds } })
      .select({ code: 1, title: 1 })
      .lean<CourseDoc[]>(),
    loadFiles(docs.flatMap((d) => d.attachmentIds)),
    loadPeople(docs.map((d) => d.createdBy)),
    ctx.asStudent ? loadStudentStates(docs, ctx.viewerId) : Promise.resolve(new Map<string, StudentState>()),
    // Grading is for the course's instructors only; administrators manage assignments but do not see work.
    ctx.canManage
      ? Enrollment.find({
          userId: ctx.viewerId,
          courseId: { $in: courseIds },
          role: 'instructor',
          status: 'active',
        })
          .select({ courseId: 1 })
          .lean<Pick<EnrollmentDoc, 'courseId'>[]>()
      : Promise.resolve([]),
  ]);
  const gradable = new Set(teaching.map((e) => e.courseId.toString()));
  const courseBy = new Map(courses.map((c) => [c._id.toString(), c]));
  return docs.map((d) => {
    const course = courseBy.get(d.courseId.toString());
    const state = states.get(d._id.toString());
    return {
      id: d._id.toString(),
      orgId: d.orgId.toString(),
      courseId: d.courseId.toString(),
      courseCode: course?.code ?? '',
      courseTitle: course?.title ?? '',
      title: d.title,
      description: d.description,
      instructions: d.instructions,
      type: d.type,
      learningObjectives: d.learningObjectives,
      maxPoints: d.maxPoints,
      rubricId: d.rubricId?.toString() ?? null,
      status: d.status,
      publishAt: d.publishAt?.toISOString() ?? null,
      publishedAt: d.publishedAt?.toISOString() ?? null,
      availableFrom: d.availableFrom?.toISOString() ?? null,
      dueAt: d.dueAt.toISOString(),
      availableUntil: d.availableUntil?.toISOString() ?? null,
      timezone: d.timezone,
      gracePeriodMinutes: d.gracePeriodMinutes,
      latePolicy: {
        mode: d.latePolicy.mode,
        penaltyPercentPerDay: d.latePolicy.penaltyPercentPerDay,
        maxLateDays: d.latePolicy.maxLateDays ?? null,
      },
      resubmission: { allowed: d.resubmission.allowed, maxAttempts: d.resubmission.maxAttempts ?? null },
      submissionMethods: {
        text: d.submissionMethods.text,
        file: d.submissionMethods.file,
        url: d.submissionMethods.url,
      },
      fileRules: {
        allowedExtensions: [...d.fileRules.allowedExtensions],
        maxFiles: d.fileRules.maxFiles,
        maxFileSizeMb: d.fileRules.maxFileSizeMb,
      },
      sectionIds: ctx.canManage ? d.sectionIds.map(String) : [],
      extensionsAllowed: d.extensionsAllowed,
      gradeRelease: d.gradeRelease,
      gradesReleasedAt: d.gradesReleasedAt?.toISOString() ?? null,
      attachments: d.attachmentIds
        .map((id) => files.get(id.toString()))
        .filter((f): f is NonNullable<typeof f> => Boolean(f)),
      createdBy: personRef(people, d.createdBy),
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
      rev: d.rev,
      my: ctx.asStudent && state ? mySummary(d, state, now) : null,
      canManage: ctx.canManage,
      canGrade: ctx.canManage && gradable.has(d.courseId.toString()),
    };
  });
}

/** Active student recipients of an assignment (enrollment + section targeting). */
export async function recipientIds(
  assignment: Pick<AssignmentDoc, 'courseId' | 'sectionIds'>,
): Promise<Id[]> {
  const filter: Record<string, unknown> = {
    courseId: assignment.courseId,
    role: 'student',
    status: 'active',
  };
  if (assignment.sectionIds.length > 0) filter.sectionId = { $in: assignment.sectionIds };
  const rows = await Enrollment.find(filter).select({ userId: 1 }).lean<Pick<EnrollmentDoc, 'userId'>[]>();
  return rows.map((r) => r.userId);
}

export async function instructorIds(courseId: Id): Promise<Id[]> {
  const rows = await Enrollment.find({ courseId, role: 'instructor', status: 'active' })
    .select({ userId: 1 })
    .lean<Pick<EnrollmentDoc, 'userId'>[]>();
  return rows.map((r) => r.userId);
}

export async function reloadAssignment(id: Id | string): Promise<AssignmentDoc> {
  const doc = await Assignment.findById(id).lean<AssignmentDoc>();
  if (!doc) throw new Error('assignment disappeared');
  return doc;
}

/**
 * Every assignment visible to a student in the organization: published/closed, in a course where they are
 * an active student, and targeted at their section. Bounded by enrollment, capped defensively.
 */
export async function studentVisibleAssignments(
  a: { orgId: string; userId: string },
  now: Date,
  extra: Record<string, unknown> = {},
): Promise<AssignmentDTO[]> {
  const enrollments = await Enrollment.find({
    userId: a.userId,
    orgId: a.orgId,
    role: 'student',
    status: 'active',
  }).lean<EnrollmentDoc[]>();
  if (enrollments.length === 0) return [];
  const enrollmentBy = new Map(enrollments.map((e) => [e.courseId.toString(), e]));
  const candidates = await Assignment.find({
    orgId: toId(a.orgId),
    courseId: { $in: enrollments.map((e) => e.courseId) },
    status: { $in: ['published', 'closed'] },
    ...extra,
  })
    .sort({ dueAt: 1, _id: 1 })
    .limit(2000)
    .lean<AssignmentDoc[]>();
  const targeted = candidates.filter((d) => {
    const e = enrollmentBy.get(d.courseId.toString());
    if (!e) return false;
    return (
      d.sectionIds.length === 0 ||
      (e.sectionId != null && d.sectionIds.some((s) => s.equals(e.sectionId as Id)))
    );
  });
  return serializeAssignments(targeted, { viewerId: a.userId, asStudent: true, canManage: false, now });
}
