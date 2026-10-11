import {
  DEFAULT_REMINDER_OFFSETS_MINUTES,
  describeOffset,
  reminderDedupeKey,
  selectReminderOffset,
} from '@sat/shared';
import { withTransaction } from '../db/connection';
import { logger } from '../lib/logger';
import {
  Announcement,
  Assignment,
  AssignmentChange,
  Course,
  ExtensionRequest,
  FileObject,
  Invitation,
  Organization,
  Submission,
  SubmissionVersion,
  User,
  type AnnouncementDoc,
  type AssignmentDoc,
  type CourseDoc,
  type ExtensionRequestDoc,
  type FileObjectDoc,
  type Id,
  type OrganizationDoc,
  type SubmissionDoc,
  type UserDoc,
} from '../models';
import { recipientIds } from '../modules/assignments/service';
import { deleteStoredFile } from '../services/files';
import { deliver } from '../services/notifications';
import { enqueue } from '../services/outbox';
import { scanner } from '../services/scanner';
import { storage } from '../services/storage';
import { formatInZone } from './handlers';

/**
 * Periodic jobs. Each uses atomic conditional updates (status guards) or unique dedupe keys, so running
 * several worker processes concurrently, or re-running after a crash, never double-applies work.
 */

export async function publishScheduledAssignments(now = new Date()): Promise<number> {
  let count = 0;
  for (;;) {
    const published = await withTransaction(async (session) => {
      const doc = await Assignment.findOneAndUpdate(
        { status: 'scheduled', publishAt: { $lte: now } },
        [
          {
            $set: {
              status: 'published',
              publishedAt: { $ifNull: ['$publishAt', now] },
              publishAt: null,
              rev: { $add: ['$rev', 1] },
            },
          },
        ],
        { returnDocument: 'after', session, updatePipeline: true },
      ).lean<AssignmentDoc>();
      if (!doc) return null;
      await AssignmentChange.create(
        [
          {
            orgId: doc.orgId,
            assignmentId: doc._id,
            actorId: null,
            kind: 'status',
            changedFields: ['status'],
            before: { status: 'scheduled' },
            after: { status: 'published' },
            note: 'Published automatically at the scheduled time',
          },
        ],
        { session },
      );
      await enqueue(
        'assignment.published',
        { assignmentId: doc._id.toString() },
        { session, dedupeKey: `assignment.published:${doc._id.toString()}` },
      );
      return doc;
    });
    if (!published) break;
    count += 1;
  }
  return count;
}

/** Published assignments past their hard-close time become "closed" (extension holders can still submit). */
export async function closeExpiredAssignments(now = new Date()): Promise<number> {
  let count = 0;
  for (;;) {
    const doc = await Assignment.findOneAndUpdate(
      { status: 'published', availableUntil: { $ne: null, $lte: now } },
      [{ $set: { status: 'closed', closedAt: '$availableUntil', rev: { $add: ['$rev', 1] } } }],
      { returnDocument: 'after', updatePipeline: true },
    ).lean<AssignmentDoc>();
    if (!doc) break;
    await AssignmentChange.create({
      orgId: doc.orgId,
      assignmentId: doc._id,
      actorId: null,
      kind: 'status',
      changedFields: ['status'],
      before: { status: 'published' },
      after: { status: 'closed' },
      note: 'Closed automatically at the availability end time',
    });
    count += 1;
  }
  return count;
}

export async function publishScheduledAnnouncements(now = new Date()): Promise<number> {
  let count = 0;
  for (;;) {
    const doc = await withTransaction(async (session) => {
      const ann = await Announcement.findOneAndUpdate(
        { status: 'scheduled', publishAt: { $lte: now } },
        [
          {
            $set: {
              status: 'published',
              publishedAt: { $ifNull: ['$publishAt', now] },
              rev: { $add: ['$rev', 1] },
            },
          },
        ],
        { returnDocument: 'after', session, updatePipeline: true },
      ).lean<AnnouncementDoc>();
      if (ann)
        await enqueue(
          'announcement.published',
          { announcementId: ann._id.toString() },
          { session, dedupeKey: `announcement.published:${ann._id.toString()}` },
        );
      return ann;
    });
    if (!doc) break;
    count += 1;
  }
  return count;
}

const MAX_OFFSET_MINUTES = 14 * 24 * 60;

/**
 * Deadline reminders. For every student with an upcoming *effective* deadline (extensions applied) who
 * has not submitted, fire the most specific elapsed reminder offset (org default, or the student's own
 * preference). Dedupe keys include the offset and the effective deadline instant, so retries never resend
 * and a moved deadline produces fresh reminders. Closed and archived assignments are skipped unless the
 * student holds an extension.
 */
export async function sendDeadlineReminders(now = new Date()): Promise<number> {
  const horizon = new Date(now.getTime() + MAX_OFFSET_MINUTES * 60_000);
  const [byDue, extensions] = await Promise.all([
    Assignment.find({ status: 'published', dueAt: { $gt: now, $lte: horizon } })
      .limit(5000)
      .lean<AssignmentDoc[]>(),
    ExtensionRequest.find({ status: 'approved', approvedDueAt: { $gt: now, $lte: horizon } })
      .limit(20_000)
      .lean<ExtensionRequestDoc[]>(),
  ]);
  const extraIds = extensions.map((e) => e.assignmentId).filter((id) => !byDue.some((a) => a._id.equals(id)));
  const extra = extraIds.length
    ? await Assignment.find({ _id: { $in: extraIds }, status: { $in: ['published', 'closed'] } }).lean<
        AssignmentDoc[]
      >()
    : [];
  const assignments = [...byDue, ...extra];
  if (assignments.length === 0) return 0;

  const orgs = await Organization.find({
    _id: { $in: [...new Set(assignments.map((a) => a.orgId.toString()))] },
    status: 'active',
  }).lean<OrganizationDoc[]>();
  const orgBy = new Map(orgs.map((o) => [o._id.toString(), o]));
  const courses = await Course.find({ _id: { $in: assignments.map((a) => a.courseId) }, status: 'active' })
    .select({ code: 1 })
    .lean<CourseDoc[]>();
  const courseBy = new Map(courses.map((c) => [c._id.toString(), c]));
  // Latest approved extension wins (matches assignments/service approvedExtensions()).
  const allExt = await ExtensionRequest.find({
    assignmentId: { $in: assignments.map((a) => a._id) },
    status: 'approved',
  })
    .sort({ decidedAt: 1 })
    .lean<ExtensionRequestDoc[]>();
  const extBy = new Map<string, Date>();
  for (const e of allExt)
    if (e.approvedDueAt) extBy.set(`${e.assignmentId.toString()}:${e.studentId.toString()}`, e.approvedDueAt);

  let sent = 0;
  for (const assignment of assignments) {
    const org = orgBy.get(assignment.orgId.toString());
    const course = courseBy.get(assignment.courseId.toString());
    if (!org || !course) continue;
    const students = await recipientIds(assignment);
    if (students.length === 0) continue;
    const [subs, users] = await Promise.all([
      Submission.find({ assignmentId: assignment._id, studentId: { $in: students } })
        .select({ studentId: 1, state: 1 })
        .lean<SubmissionDoc[]>(),
      User.find({ _id: { $in: students }, status: 'active' })
        .select({ notificationPreferences: 1 })
        .lean<UserDoc[]>(),
    ]);
    const done = new Set(
      subs.filter((s) => s.state === 'submitted' || s.state === 'graded').map((s) => s.studentId.toString()),
    );
    const groups = new Map<string, { offset: number; due: Date; userIds: Id[] }>();
    for (const user of users) {
      const key = user._id.toString();
      if (done.has(key)) continue;
      const ext = extBy.get(`${assignment._id.toString()}:${key}`) ?? null;
      if (assignment.status === 'closed' && !ext) continue;
      const due = ext ?? assignment.dueAt;
      const offsets = user.notificationPreferences?.reminderOffsetsMinutes ??
        org.settings.reminderOffsetsMinutes ?? [...DEFAULT_REMINDER_OFFSETS_MINUTES];
      const offset = selectReminderOffset(due, offsets, now);
      if (offset == null) continue;
      const gk = `${offset}:${due.toISOString()}`;
      const group = groups.get(gk) ?? { offset, due, userIds: [] };
      group.userIds.push(user._id);
      groups.set(gk, group);
    }
    for (const group of groups.values()) {
      sent += await deliver({
        orgId: assignment.orgId,
        userIds: group.userIds,
        type: 'deadline_reminder',
        title: `Due in ${describeOffset(group.offset)}: ${assignment.title}`,
        body: `${course.code} · due ${formatInZone(group.due, assignment.timezone)}.`,
        link: `/o/${assignment.orgId.toString()}/assignments/${assignment._id.toString()}`,
        refType: 'assignment',
        refId: assignment._id,
        dedupeKey: reminderDedupeKey(assignment._id.toString(), group.offset, group.due),
        email: true,
      });
    }
  }
  return sent;
}

export async function expireInvitations(now = new Date()): Promise<number> {
  const result = await Invitation.updateMany(
    { status: 'pending', expiresAt: { $lte: now } },
    { $set: { status: 'expired' } },
  );
  return result.modifiedCount;
}

/**
 * Orphaned uploads: files still "pending" after 24 hours that no draft or submitted version references
 * (e.g. the browser uploaded but the student never saved). Object first, then metadata is marked deleted.
 */
export async function cleanupOrphanFiles(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 24 * 3600_000);
  const candidates = await FileObject.find({ status: 'pending', createdAt: { $lt: cutoff } })
    .limit(500)
    .lean<FileObjectDoc[]>();
  let removed = 0;
  for (const file of candidates) {
    const referenced =
      (await Submission.exists({ 'draft.fileIds': file._id })) ||
      (await SubmissionVersion.exists({ 'files.fileId': file._id })) ||
      (await Assignment.exists({ attachmentIds: file._id }));
    if (referenced) continue;
    await deleteStoredFile(file);
    removed += 1;
  }
  return removed;
}

/** Re-scans files whose scan failed or never ran (only when a real scanner is configured). */
export async function retryFileScans(): Promise<number> {
  if (scanner().name === 'none') return 0;
  const files = await FileObject.find({
    status: { $ne: 'deleted' },
    scanStatus: { $in: ['pending', 'error', 'skipped'] },
  })
    .limit(50)
    .lean<FileObjectDoc[]>();
  let scanned = 0;
  for (const file of files) {
    try {
      const stream = await storage().get(file.storageKey);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
      const result = await scanner().scan(Buffer.concat(chunks));
      await FileObject.updateOne({ _id: file._id }, { $set: { scanStatus: result } });
      if (result === 'infected')
        logger().warn({ fileId: file._id.toString() }, 'stored file flagged as infected on rescan');
      scanned += 1;
    } catch (err) {
      logger().warn({ err, fileId: file._id.toString() }, 'rescan failed');
    }
  }
  return scanned;
}
