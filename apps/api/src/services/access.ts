import type { Request } from 'express';
import { isVisibleToStudents } from '@sat/shared';
import { errors } from '../lib/errors';
import { requireAuth, requireOrg } from '../lib/request';
import {
  Assignment,
  Course,
  Enrollment,
  isValidId,
  type AssignmentDoc,
  type CourseDoc,
  type EnrollmentDoc,
  type Id,
} from '../models';

/**
 * Centralised authorization policy. Every route that touches course-scoped data goes through these
 * functions; there are no ad-hoc role checks in route handlers. Policies default to deny, always scope by
 * the caller's organization, and report "not found" for resources outside the caller's reach so that
 * identifiers cannot be probed (IDOR protection).
 *
 * Roles
 *  - org_admin: manages organization structure (members, courses, enrollments, settings, audit). Does NOT
 *    read private submissions or grades by default; that requires the audited break-glass endpoint.
 *  - teacher:   may create courses (if the org allows) and manages only courses where they hold an active
 *    "instructor" enrollment.
 *  - student:   reads only courses with an active "student" enrollment, and only their own work.
 */

export interface Actor {
  userId: string;
  orgId: string;
  orgRole: 'student' | 'teacher' | 'org_admin';
}

export function actor(req: Request): Actor {
  const auth = requireAuth(req);
  const org = requireOrg(req);
  if (!org.membership) throw errors.forbidden();
  return { userId: auth.userId, orgId: org.orgId, orgRole: org.membership.role };
}

export const isOrgAdmin = (a: Actor) => a.orgRole === 'org_admin';

export function requireOrgAdmin(a: Actor): void {
  if (!isOrgAdmin(a)) throw errors.forbidden();
}

export interface CourseAccess {
  course: CourseDoc;
  enrollment: EnrollmentDoc | null;
  isInstructor: boolean;
  isStudent: boolean;
  isAdmin: boolean;
  /** Instructor of the course or organization administrator. */
  canManage: boolean;
}

export async function loadCourseAccess(a: Actor, courseId: string | Id): Promise<CourseAccess> {
  if (!isValidId(String(courseId))) throw errors.notFound('Course');
  const [course, enrollment] = await Promise.all([
    Course.findOne({ _id: courseId, orgId: a.orgId }).lean<CourseDoc>(),
    Enrollment.findOne({ courseId, userId: a.userId, status: 'active' }).lean<EnrollmentDoc>(),
  ]);
  if (!course) throw errors.notFound('Course');
  const isInstructor = enrollment?.role === 'instructor' && a.orgRole !== 'student';
  const isStudent = enrollment?.role === 'student';
  const isAdmin = isOrgAdmin(a);
  if (!isInstructor && !isStudent && !isAdmin) throw errors.notFound('Course');
  return { course, enrollment, isInstructor, isStudent, isAdmin, canManage: isInstructor || isAdmin };
}

/** Course must be manageable (instructor or org admin) and, for writes, not archived. */
export async function requireCourseManager(
  a: Actor,
  courseId: string | Id,
  opts: { write?: boolean } = {},
): Promise<CourseAccess> {
  const access = await loadCourseAccess(a, courseId);
  if (!access.canManage) throw errors.notFound('Course');
  if (opts.write && access.course.status === 'archived') {
    throw errors.conflict('This course is archived. Restore it before making changes.', 'course_archived');
  }
  return access;
}

/** Teaching staff only (instructors). Org admins manage structure but not grading. */
export async function requireCourseInstructor(
  a: Actor,
  courseId: string | Id,
  opts: { write?: boolean } = {},
): Promise<CourseAccess> {
  const access = await requireCourseManager(a, courseId, opts);
  if (!access.isInstructor) throw errors.forbidden('Only course instructors can do this.');
  return access;
}

export interface AssignmentAccess extends CourseAccess {
  assignment: AssignmentDoc;
  /** Whether this student is a recipient of the assignment (enrollment + section targeting). */
  isRecipient: boolean;
}

export function isTargeted(
  assignment: Pick<AssignmentDoc, 'sectionIds'>,
  enrollment: Pick<EnrollmentDoc, 'sectionId'> | null,
): boolean {
  if (!enrollment) return false;
  if (assignment.sectionIds.length === 0) return true;
  return (
    enrollment.sectionId != null && assignment.sectionIds.some((s) => s.equals(enrollment.sectionId as Id))
  );
}

/**
 * Loads an assignment for the caller. Students must be enrolled recipients and the assignment must be
 * visible (published or closed) — drafts, scheduled and archived assignments are invisible to them.
 */
export async function loadAssignmentAccess(a: Actor, assignmentId: string): Promise<AssignmentAccess> {
  if (!isValidId(assignmentId)) throw errors.notFound('Assignment');
  const assignment = await Assignment.findOne({ _id: assignmentId, orgId: a.orgId }).lean<AssignmentDoc>();
  if (!assignment) throw errors.notFound('Assignment');
  let access: CourseAccess;
  try {
    access = await loadCourseAccess(a, assignment.courseId);
  } catch {
    throw errors.notFound('Assignment');
  }
  const isRecipient = access.isStudent && isTargeted(assignment, access.enrollment);
  if (!access.canManage) {
    if (!isRecipient || !isVisibleToStudents(assignment.status)) throw errors.notFound('Assignment');
  }
  return { ...access, assignment, isRecipient };
}

export async function requireAssignmentManager(
  a: Actor,
  assignmentId: string,
  opts: { write?: boolean } = {},
): Promise<AssignmentAccess> {
  const access = await loadAssignmentAccess(a, assignmentId);
  if (!access.canManage) throw errors.notFound('Assignment');
  if (opts.write && access.course.status === 'archived') {
    throw errors.conflict('This course is archived. Restore it before making changes.', 'course_archived');
  }
  return access;
}

export async function requireAssignmentInstructor(
  a: Actor,
  assignmentId: string,
  opts: { write?: boolean } = {},
): Promise<AssignmentAccess> {
  const access = await requireAssignmentManager(a, assignmentId, opts);
  if (!access.isInstructor) throw errors.forbidden('Only course instructors can do this.');
  return access;
}

export async function requireAssignmentStudent(a: Actor, assignmentId: string): Promise<AssignmentAccess> {
  const access = await loadAssignmentAccess(a, assignmentId);
  if (!access.isRecipient)
    throw errors.forbidden('Only students assigned this work can submit it.', 'not_a_recipient');
  return access;
}

/** Course ids the caller teaches (instructor) or studies in, within the org. */
export async function myCourseIds(a: Actor, role: 'instructor' | 'student'): Promise<Id[]> {
  const rows = await Enrollment.find({ orgId: a.orgId, userId: a.userId, role, status: 'active' })
    .select({ courseId: 1 })
    .lean<{ courseId: Id }[]>();
  return rows.map((r) => r.courseId);
}
