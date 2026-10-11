import type { Request } from 'express';
import { parse } from 'csv-parse/sync';
import {
  LIMITS,
  rosterImportRowSchema,
  type CourseDTO,
  type EnrollmentDTO,
  type EnrollmentRole,
  type RosterImportPreviewDTO,
  type RosterImportRowResult,
} from '@sat/shared';
import { withTransaction } from '../../db/connection';
import { sha256Hex } from '../../lib/crypto';
import { errors } from '../../lib/errors';
import {
  Department,
  Enrollment,
  Membership,
  Section,
  User,
  toId,
  type CourseDoc,
  type DepartmentDoc,
  type EnrollmentDoc,
  type Id,
  type MembershipDoc,
  type SectionDoc,
  type UserDoc,
} from '../../models';
import type { Actor } from '../../services/access';
import { audit } from '../../services/audit';
import { deliver } from '../../services/notifications';
import { createInvitation } from '../orgs/routes';

export async function serializeCourses(courses: CourseDoc[], viewerId: string): Promise<CourseDTO[]> {
  if (courses.length === 0) return [];
  const ids = courses.map((c) => c._id);
  const [enrollments, depts, counts] = await Promise.all([
    Enrollment.find({
      courseId: { $in: ids },
      status: 'active',
      $or: [{ role: 'instructor' }, { userId: viewerId }],
    })
      .select({ courseId: 1, userId: 1, role: 1 })
      .lean<Pick<EnrollmentDoc, 'courseId' | 'userId' | 'role'>[]>(),
    Department.find({ _id: { $in: courses.map((c) => c.departmentId).filter(Boolean) } })
      .select({ name: 1 })
      .lean<DepartmentDoc[]>(),
    Enrollment.aggregate<{ _id: Id; n: number }>([
      { $match: { courseId: { $in: ids }, role: 'student', status: 'active' } },
      { $group: { _id: '$courseId', n: { $sum: 1 } } },
    ]),
  ]);
  const instructorIds = enrollments.filter((e) => e.role === 'instructor').map((e) => e.userId);
  const users = await User.find({ _id: { $in: instructorIds } })
    .select({ name: 1 })
    .lean<Pick<UserDoc, '_id' | 'name'>[]>();
  const nameOf = new Map(users.map((u) => [u._id.toString(), u.name]));
  const deptName = new Map(depts.map((d) => [d._id.toString(), d.name]));
  const countOf = new Map(counts.map((c) => [c._id.toString(), c.n]));
  return courses.map((c) => {
    const own = enrollments.filter((e) => e.courseId.equals(c._id));
    const mine = own.find((e) => e.userId.toString() === viewerId);
    return {
      id: c._id.toString(),
      orgId: c.orgId.toString(),
      code: c.code,
      title: c.title,
      description: c.description,
      term: c.term,
      status: c.status,
      departmentId: c.departmentId?.toString() ?? null,
      departmentName: c.departmentId ? (deptName.get(c.departmentId.toString()) ?? null) : null,
      instructors: own
        .filter((e) => e.role === 'instructor')
        .map((e) => ({ id: e.userId.toString(), name: nameOf.get(e.userId.toString()) ?? 'Instructor' })),
      studentCount: countOf.get(c._id.toString()) ?? 0,
      myRole: mine?.role ?? null,
      createdAt: c.createdAt.toISOString(),
    };
  });
}

export async function serializeEnrollments(rows: EnrollmentDoc[], orgId: string): Promise<EnrollmentDTO[]> {
  const userIds = rows.map((r) => r.userId);
  const [users, sections, memberships] = await Promise.all([
    User.find({ _id: { $in: userIds } })
      .select({ name: 1, email: 1 })
      .lean<Pick<UserDoc, '_id' | 'name' | 'email'>[]>(),
    Section.find({ _id: { $in: rows.map((r) => r.sectionId).filter(Boolean) } })
      .select({ name: 1 })
      .lean<SectionDoc[]>(),
    Membership.find({ orgId, userId: { $in: userIds } })
      .select({ userId: 1, studentNumber: 1 })
      .lean<MembershipDoc[]>(),
  ]);
  const u = new Map(users.map((x) => [x._id.toString(), x]));
  const s = new Map(sections.map((x) => [x._id.toString(), x.name]));
  const m = new Map(memberships.map((x) => [x.userId.toString(), x.studentNumber]));
  return rows.map((e) => ({
    id: e._id.toString(),
    userId: e.userId.toString(),
    name: u.get(e.userId.toString())?.name ?? 'Unknown',
    email: u.get(e.userId.toString())?.email ?? '',
    role: e.role,
    status: e.status,
    sectionId: e.sectionId?.toString() ?? null,
    sectionName: e.sectionId ? (s.get(e.sectionId.toString()) ?? null) : null,
    studentNumber: m.get(e.userId.toString()) ?? null,
    enrolledAt: e.enrolledAt.toISOString(),
  }));
}

/** Enrolls an existing active org member; instructors must hold a teacher/admin membership. */
export async function enrollMember(
  req: Request,
  a: Actor,
  course: CourseDoc,
  userId: string,
  role: EnrollmentRole,
  sectionId: string | null,
): Promise<EnrollmentDoc> {
  const membership = await Membership.findOne({
    orgId: a.orgId,
    userId,
    status: 'active',
  }).lean<MembershipDoc>();
  if (!membership)
    throw errors.validation(
      'This person is not an active member of the organization.',
      { userId: ['Not a member'] },
      'not_a_member',
    );
  if (role === 'instructor' && membership.role === 'student') {
    throw errors.validation(
      'Only teachers or administrators can be course instructors.',
      { role: ['Not permitted'] },
      'invalid_instructor',
    );
  }
  if (sectionId && !(await Section.exists({ _id: sectionId, courseId: course._id, status: 'active' })))
    throw errors.notFound('Section');
  const now = new Date();
  const enrollment = await Enrollment.findOneAndUpdate(
    { courseId: course._id, userId },
    {
      $set: { role, status: 'active', sectionId: sectionId ? toId(sectionId) : null, droppedAt: null },
      $setOnInsert: { orgId: course.orgId, courseId: course._id, userId: toId(userId), enrolledAt: now },
    },
    { upsert: true, returnDocument: 'after' },
  ).lean<EnrollmentDoc>();
  if (!enrollment) throw new Error('enrollment upsert failed');
  await audit({
    req,
    action: 'enrollment.added',
    targetType: 'course',
    targetId: course._id,
    metadata: { userId, role, sectionId },
  });
  await deliver({
    orgId: a.orgId,
    userIds: [userId],
    type: 'enrollment',
    title: `Added to ${course.code}`,
    body: `You were added to ${course.code} — ${course.title} as ${role === 'instructor' ? 'an instructor' : 'a student'}.`,
    link: `/o/${a.orgId}/courses/${course._id.toString()}`,
    refType: 'course',
    refId: course._id,
    dedupeKey: `enrolled:${course._id.toString()}:${enrollment.enrolledAt.getTime()}:${role}`,
  });
  return enrollment;
}

/* ───────────── CSV roster import ───────────── */

interface ParsedRows {
  rows: RosterImportRowResult[];
  contentHash: string;
}

export async function analyseRoster(a: Actor, course: CourseDoc, csv: string): Promise<ParsedRows> {
  let records: Record<string, string>[];
  try {
    records = parse(csv, {
      columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
      bom: true,
      max_record_size: 4096,
      to: LIMITS.csvImportRows + 1,
    }) as Record<string, string>[];
  } catch (err) {
    throw errors.validation(`The CSV could not be read: ${(err as Error).message}`, undefined, 'invalid_csv');
  }
  if (records.length === 0) throw errors.validation('The CSV has no data rows.', undefined, 'invalid_csv');
  if (records.length > LIMITS.csvImportRows)
    throw errors.validation(
      `Import at most ${LIMITS.csvImportRows} rows at a time.`,
      undefined,
      'too_many_rows',
    );
  if (!('email' in (records[0] ?? {})))
    throw errors.validation('The CSV must have an "email" column.', undefined, 'invalid_csv');

  const emails = records.map((r) => (r.email ?? '').trim().toLowerCase());
  const users = await User.find({ email: { $in: emails } })
    .select({ email: 1 })
    .lean<Pick<UserDoc, '_id' | 'email'>[]>();
  const userByEmail = new Map(users.map((u) => [u.email, u]));
  const memberships = await Membership.find({
    orgId: a.orgId,
    userId: { $in: users.map((u) => u._id) },
    status: 'active',
  }).lean<MembershipDoc[]>();
  const memberRole = new Map(memberships.map((m) => [m.userId.toString(), m.role]));
  const enrolled = new Set(
    (
      await Enrollment.find({
        courseId: course._id,
        status: 'active',
        userId: { $in: users.map((u) => u._id) },
      })
        .select({ userId: 1 })
        .lean<EnrollmentDoc[]>()
    ).map((e) => e.userId.toString()),
  );
  const sections = await Section.find({ courseId: course._id, status: 'active' }).lean<SectionDoc[]>();
  const sectionNames = new Set(sections.map((s) => s.name.toLowerCase()));
  const seen = new Set<string>();

  const rows: RosterImportRowResult[] = records.map((raw, i) => {
    const line = i + 2;
    const parsed = rosterImportRowSchema.safeParse({
      email: raw.email,
      name: raw.name,
      role: raw.role || undefined,
      section: raw.section,
    });
    if (!parsed.success) {
      return {
        line,
        email: raw.email ?? '',
        name: raw.name ?? '',
        role: 'student',
        section: raw.section ?? '',
        action: 'error',
        errors: parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`),
      };
    }
    const row = parsed.data;
    const base = { line, email: row.email, name: row.name, role: row.role, section: row.section };
    if (seen.has(row.email))
      return { ...base, action: 'skip_duplicate', errors: ['Duplicate email in file'] };
    seen.add(row.email);
    const problems: string[] = [];
    if (row.section && !sectionNames.has(row.section.toLowerCase()))
      problems.push(`Unknown section "${row.section}"`);
    if (row.role === 'instructor' && a.orgRole !== 'org_admin')
      problems.push('Only administrators can import instructors');
    const user = userByEmail.get(row.email);
    const role = user ? memberRole.get(user._id.toString()) : undefined;
    if (row.role === 'instructor' && role === 'student')
      problems.push('A student member cannot be an instructor');
    if (row.role === 'instructor' && !role) problems.push('Instructors must already be organization members');
    if (problems.length) return { ...base, action: 'error', errors: problems };
    if (user && enrolled.has(user._id.toString())) return { ...base, action: 'skip_enrolled', errors: [] };
    return { ...base, action: role ? 'enroll' : 'invite', errors: [] };
  });
  return { rows, contentHash: sha256Hex(csv) };
}

export function summarize(rows: RosterImportRowResult[]): RosterImportPreviewDTO['summary'] {
  return {
    total: rows.length,
    enroll: rows.filter((r) => r.action === 'enroll').length,
    invite: rows.filter((r) => r.action === 'invite').length,
    skipped: rows.filter((r) => r.action === 'skip_duplicate' || r.action === 'skip_enrolled').length,
    errors: rows.filter((r) => r.action === 'error').length,
  };
}

/**
 * Commits a previewed import. Rows with errors block the whole import (nothing is silently dropped).
 * Enrollments are written in one transaction; invitations (which send email) are created afterwards and
 * are individually idempotent, so a partial failure can be resumed by re-running the same file.
 */
export async function commitRoster(
  req: Request,
  a: Actor,
  course: CourseDoc,
  csv: string,
  expectedHash: string,
) {
  const { rows, contentHash } = await analyseRoster(a, course, csv);
  if (contentHash !== expectedHash)
    throw errors.conflict('The file changed since it was previewed. Preview it again.', 'preview_mismatch');
  const summary = summarize(rows);
  if (summary.errors > 0)
    throw errors.validation('Fix the rows with errors before importing.', undefined, 'import_has_errors');

  const sections = await Section.find({ courseId: course._id, status: 'active' }).lean<SectionDoc[]>();
  const sectionId = (name: string) =>
    sections.find((s) => s.name.toLowerCase() === name.toLowerCase())?._id ?? null;
  const toEnroll = rows.filter((r) => r.action === 'enroll');
  const users = await User.find({ email: { $in: toEnroll.map((r) => r.email) } })
    .select({ email: 1 })
    .lean<Pick<UserDoc, '_id' | 'email'>[]>();
  const idByEmail = new Map(users.map((u) => [u.email, u._id]));
  const now = new Date();

  await withTransaction(async (session) => {
    for (const row of toEnroll) {
      const userId = idByEmail.get(row.email);
      if (!userId) continue;
      await Enrollment.updateOne(
        { courseId: course._id, userId },
        {
          $set: { role: row.role, status: 'active', sectionId: sectionId(row.section), droppedAt: null },
          $setOnInsert: { orgId: course.orgId, courseId: course._id, userId, enrolledAt: now },
        },
        { upsert: true, session },
      );
    }
  });
  let invited = 0;
  for (const row of rows.filter((r) => r.action === 'invite')) {
    await createInvitation(req, { email: row.email, role: 'student', courseId: course._id.toString() });
    invited += 1;
  }
  await audit({
    req,
    action: 'roster.imported',
    targetType: 'course',
    targetId: course._id,
    metadata: { ...summary, contentHash },
  });
  return { ...summary, invite: invited };
}
