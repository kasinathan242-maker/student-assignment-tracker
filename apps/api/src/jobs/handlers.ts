import { DateTime } from 'luxon';
import type { OrgRole } from '@sat/shared';
import { logger } from '../lib/logger';
import { unseal } from '../lib/seal';
import {
  Announcement,
  Assignment,
  Course,
  Enrollment,
  ExtensionRequest,
  Grade,
  Membership,
  Submission,
  SubmissionVersion,
  type AnnouncementDoc,
  type AssignmentDoc,
  type CourseDoc,
  type ExtensionRequestDoc,
  type GradeDoc,
  type Id,
  type SubmissionDoc,
  type SubmissionVersionDoc,
} from '../models';
import { recipientIds, instructorIds } from '../modules/assignments/service';
import { emailProvider } from '../services/email/provider';
import { renderEmail, type EmailTemplate } from '../services/email/templates';
import { isGradeVisible } from '../services/gradeVisibility';
import { deliver } from '../services/notifications';
import { registerOutboxHandler } from '../services/outbox';

export function formatInZone(date: Date, zone: string): string {
  return DateTime.fromJSDate(date).setZone(zone).toFormat('ccc d LLL yyyy, HH:mm ZZZZ');
}

const str = (v: unknown) => String(v);

async function loadAssignment(id: unknown): Promise<{ assignment: AssignmentDoc; course: CourseDoc } | null> {
  const assignment = await Assignment.findById(str(id)).lean<AssignmentDoc>();
  if (!assignment) return null;
  const course = await Course.findById(assignment.courseId).lean<CourseDoc>();
  return course ? { assignment, course } : null;
}

const assignmentLink = (a: AssignmentDoc) => `/o/${a.orgId.toString()}/assignments/${a._id.toString()}`;

/**
 * Outbox handlers. Each is idempotent: notification dedupe keys make redelivery harmless, and handlers
 * re-read current state so a stale event (e.g. assignment archived since) does not notify anyone.
 */
export function registerHandlers(): void {
  registerOutboxHandler(
    'email.send',
    async (payload) => {
      const to = unseal(str(payload.to));
      const vars = JSON.parse(unseal(str(payload.vars))) as Record<string, string>;
      const template = str(payload.template) as EmailTemplate;
      const rendered = renderEmail(template, vars);
      await emailProvider().send({ to, ...rendered, category: template });
    },
    { sensitive: true },
  );

  registerOutboxHandler('assignment.published', async (payload) => {
    const loaded = await loadAssignment(payload.assignmentId);
    if (!loaded || !['published', 'closed'].includes(loaded.assignment.status)) return;
    const { assignment, course } = loaded;
    await deliver({
      orgId: assignment.orgId,
      userIds: await recipientIds(assignment),
      type: 'assignment_published',
      title: `New assignment in ${course.code}: ${assignment.title}`,
      body: `Due ${formatInZone(assignment.dueAt, assignment.timezone)}.`,
      link: assignmentLink(assignment),
      refType: 'assignment',
      refId: assignment._id,
      dedupeKey: `assignment.published:${assignment._id.toString()}`,
      email: true,
    });
  });

  registerOutboxHandler('assignment.changed', async (payload) => {
    const loaded = await loadAssignment(payload.assignmentId);
    if (!loaded || !['published', 'closed'].includes(loaded.assignment.status)) return;
    const { assignment, course } = loaded;
    const deadline = payload.deadlineChanged === true;
    await deliver({
      orgId: assignment.orgId,
      userIds: await recipientIds(assignment),
      type: deadline ? 'deadline_changed' : 'assignment_updated',
      title: deadline ? `Deadline changed: ${assignment.title}` : `Assignment updated: ${assignment.title}`,
      body: deadline
        ? `${course.code} · now due ${formatInZone(assignment.dueAt, assignment.timezone)}.`
        : `${course.code} · the instructor changed the assignment requirements. Review the details.`,
      link: assignmentLink(assignment),
      refType: 'assignment',
      refId: assignment._id,
      dedupeKey: `assignment.changed:${str(payload.changeId)}`,
      email: deadline,
    });
  });

  registerOutboxHandler('submission.submitted', async (payload) => {
    const version = await SubmissionVersion.findById(str(payload.versionId)).lean<SubmissionVersionDoc>();
    const loaded = version ? await loadAssignment(version.assignmentId) : null;
    if (!version || !loaded) return;
    const { assignment, course } = loaded;
    await deliver({
      orgId: assignment.orgId,
      userIds: [version.studentId],
      type: 'submission_confirmed',
      title: `Submission received: ${assignment.title}`,
      body: `Receipt ${version.receiptCode} · attempt ${version.attemptNumber}${version.isLate ? ' · submitted late' : ''}.`,
      link: assignmentLink(assignment),
      refType: 'submission',
      refId: version.submissionId,
      dedupeKey: `submission.confirmed:${version._id.toString()}`,
      email: true,
    });
    await deliver({
      orgId: assignment.orgId,
      userIds: await instructorIds(course._id),
      type: 'submission_received',
      title: `New submission: ${assignment.title}`,
      body: `${course.code} · attempt ${version.attemptNumber}${version.isLate ? ' (late)' : ''}.`,
      link: `/o/${assignment.orgId.toString()}/grading/${version.submissionId.toString()}`,
      refType: 'submission',
      refId: version.submissionId,
      dedupeKey: `submission.received:${version._id.toString()}`,
    });
  });

  registerOutboxHandler('submission.returned', async (payload) => {
    const sub = await Submission.findById(str(payload.submissionId)).lean<SubmissionDoc>();
    const loaded = sub ? await loadAssignment(sub.assignmentId) : null;
    if (!sub || !loaded || sub.state !== 'returned') return;
    await deliver({
      orgId: sub.orgId,
      userIds: [sub.studentId],
      type: 'submission_returned',
      title: `Revision requested: ${loaded.assignment.title}`,
      body: 'Your instructor returned your work with feedback. Review it and resubmit.',
      link: assignmentLink(loaded.assignment),
      refType: 'submission',
      refId: sub._id,
      dedupeKey: `submission.returned:${sub._id.toString()}:${sub.returnedAt?.getTime() ?? 0}`,
      email: true,
    });
  });

  const notifyGrade = async (grade: GradeDoc, assignment: AssignmentDoc, key: string) => {
    if (!isGradeVisible(grade, assignment) || !grade.published) return;
    await deliver({
      orgId: grade.orgId,
      userIds: [grade.studentId],
      type: 'grade_published',
      title: `Grade available: ${assignment.title}`,
      body: grade.published.feedback ? 'Your grade and feedback are ready.' : 'Your grade is ready.',
      link: assignmentLink(assignment),
      refType: 'submission',
      refId: grade.submissionId,
      dedupeKey: key,
      email: true,
    });
  };

  registerOutboxHandler('grade.published', async (payload) => {
    const grade = await Grade.findById(str(payload.gradeId)).lean<GradeDoc>();
    const loaded = grade ? await loadAssignment(grade.assignmentId) : null;
    if (!grade || !loaded) return;
    // The event carries its own publication instant so a correction never dedupes against the original.
    await notifyGrade(grade, loaded.assignment, `grade:${grade._id.toString()}:${str(payload.publishedAt)}`);
  });

  registerOutboxHandler('grades.released', async (payload) => {
    const loaded = await loadAssignment(payload.assignmentId);
    if (!loaded) return;
    const grades = await Grade.find({ assignmentId: loaded.assignment._id, published: { $ne: null } }).lean<
      GradeDoc[]
    >();
    for (const grade of grades)
      await notifyGrade(grade, loaded.assignment, `grade:${grade._id.toString()}:released`);
  });

  registerOutboxHandler('extension.requested', async (payload) => {
    const req = await ExtensionRequest.findById(str(payload.requestId)).lean<ExtensionRequestDoc>();
    const loaded = req ? await loadAssignment(req.assignmentId) : null;
    if (!req || !loaded || req.status !== 'pending') return;
    await deliver({
      orgId: req.orgId,
      userIds: await instructorIds(req.courseId),
      type: 'extension_requested',
      title: `Extension request: ${loaded.assignment.title}`,
      body: `${loaded.course.code} · requested until ${formatInZone(req.requestedDueAt, loaded.assignment.timezone)}.`,
      link: `/o/${req.orgId.toString()}/extensions`,
      refType: 'extension',
      refId: req._id,
      dedupeKey: `extension.requested:${req._id.toString()}`,
    });
  });

  registerOutboxHandler('extension.decided', async (payload) => {
    const req = await ExtensionRequest.findById(str(payload.requestId)).lean<ExtensionRequestDoc>();
    const loaded = req ? await loadAssignment(req.assignmentId) : null;
    if (!req || !loaded || !['approved', 'denied'].includes(req.status)) return;
    const approved = req.status === 'approved' && req.approvedDueAt;
    await deliver({
      orgId: req.orgId,
      userIds: [req.studentId],
      type: 'extension_decided',
      title: approved
        ? `Extension approved: ${loaded.assignment.title}`
        : `Extension not approved: ${loaded.assignment.title}`,
      body: approved
        ? `Your new due date is ${formatInZone(req.approvedDueAt as Date, loaded.assignment.timezone)}.`
        : (req.decisionNote ?? 'Your original due date still applies.'),
      link: assignmentLink(loaded.assignment),
      refType: 'extension',
      refId: req._id,
      dedupeKey: `extension.decided:${req._id.toString()}`,
      email: true,
    });
  });

  registerOutboxHandler('announcement.published', async (payload) => {
    const ann = await Announcement.findById(str(payload.announcementId)).lean<AnnouncementDoc>();
    if (!ann || ann.status !== 'published') return;
    let userIds: Id[];
    if (ann.courseId) {
      userIds = (
        await Enrollment.find({ courseId: ann.courseId, status: 'active' }).select({ userId: 1 }).lean()
      ).map((e) => e.userId);
    } else {
      const roles: OrgRole[] =
        ann.audience === 'org_students'
          ? ['student']
          : ann.audience === 'org_teachers'
            ? ['teacher', 'org_admin']
            : ['student', 'teacher', 'org_admin'];
      userIds = (
        await Membership.find({ orgId: ann.orgId, status: 'active', role: { $in: roles } })
          .select({ userId: 1 })
          .lean()
      ).map((m) => m.userId);
    }
    userIds = userIds.filter((id) => !id.equals(ann.authorId));
    const course = ann.courseId
      ? await Course.findById(ann.courseId).select({ code: 1 }).lean<CourseDoc>()
      : null;
    await deliver({
      orgId: ann.orgId,
      userIds,
      type: 'announcement',
      title: course ? `${course.code}: ${ann.title}` : ann.title,
      body: ann.body.replace(/[#*_`>[\]()]/g, '').slice(0, 280),
      link: `/o/${ann.orgId.toString()}/announcements/${ann._id.toString()}`,
      refType: 'announcement',
      refId: ann._id,
      dedupeKey: `announcement:${ann._id.toString()}`,
      email: ann.sendEmail,
    });
  });

  logger().debug('outbox handlers registered');
}
