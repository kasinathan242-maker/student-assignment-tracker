import type { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanupOrphanFiles,
  closeExpiredAssignments,
  publishScheduledAnnouncements,
  publishScheduledAssignments,
  sendDeadlineReminders,
} from '../src/jobs/scheduled';
import {
  Announcement,
  Assignment,
  ExtensionRequest,
  FileObject,
  Notification,
  OutboxEvent,
  SubmissionVersion,
} from '../src/models';
import { emailProvider, setEmailProvider, type EmailProvider } from '../src/services/email/provider';
import { drainOutbox, enqueue } from '../src/services/outbox';
import { storage } from '../src/services/storage';
import {
  assignmentInput,
  buildWorld,
  flushOutbox,
  PDF,
  signedIn,
  startTestApp,
  stopTestApp,
  type World,
} from './helpers';

let app: Express;
let w: World;
let A: string;

beforeAll(async () => {
  app = await startTestApp();
});
afterAll(stopTestApp);
beforeEach(async () => {
  w = await buildWorld();
  A = `/orgs/${w.orgA._id.toString()}`;
});

async function published(overrides = {}) {
  const teacher = await signedIn(app, w.users.teacherA);
  const created = await teacher.post(
    `${A}/courses/${w.course._id.toString()}/assignments`,
    assignmentInput(overrides),
  );
  const res = await teacher.post(`${A}/assignments/${created.body.id}/publish`, {
    expectedRev: created.body.rev,
  });
  await flushOutbox();
  return { teacher, id: res.body.id as string };
}

describe('scheduled publication', () => {
  it('publishes at the scheduled time exactly once and notifies students', async () => {
    const teacher = await signedIn(app, w.users.teacherA);
    const created = await teacher.post(
      `${A}/courses/${w.course._id.toString()}/assignments`,
      assignmentInput(),
    );
    const publishAt = new Date(Date.now() + 60_000);
    const scheduled = await teacher.post(`${A}/assignments/${created.body.id}/schedule`, {
      publishAt: publishAt.toISOString(),
      expectedRev: created.body.rev,
    });
    expect(scheduled.body.status).toBe('scheduled');
    expect(await publishScheduledAssignments(new Date())).toBe(0);
    const later = new Date(publishAt.getTime() + 1000);
    const [a, b] = await Promise.all([
      publishScheduledAssignments(later),
      publishScheduledAssignments(later),
    ]);
    expect(a + b).toBe(1); // concurrent workers cannot double-publish
    await flushOutbox();
    expect(
      await Notification.countDocuments({
        type: 'assignment_published',
        userId: { $in: [w.users.studentA._id, w.users.studentB._id] },
      }),
    ).toBe(2);
    expect((await Assignment.findById(created.body.id))?.status).toBe('published');
  });

  it('closes assignments at their availability end and publishes scheduled announcements', async () => {
    const { id } = await published({ availableUntil: new Date(Date.now() + 4 * 86_400_000).toISOString() });
    expect(await closeExpiredAssignments(new Date(Date.now() + 5 * 86_400_000))).toBe(1);
    expect((await Assignment.findById(id))?.status).toBe('closed');
    const teacher = await signedIn(app, w.users.teacherA);
    await teacher.post(`${A}/announcements`, {
      title: 'Soon',
      body: 'Hi',
      audience: 'course',
      courseId: w.course._id.toString(),
      publishAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(await publishScheduledAnnouncements(new Date(Date.now() + 120_000))).toBe(1);
    expect(await Announcement.countDocuments({ status: 'published' })).toBe(1);
  });
});

describe('deadline reminders', () => {
  it('sends the most specific reminder once, skips submitted students and honours extensions', async () => {
    const dueAt = new Date(Date.now() + 30 * 60_000); // due in 30 minutes
    const { id } = await published({
      dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      extensionsAllowed: true,
    });
    await Assignment.updateOne({ _id: id }, { $set: { dueAt } });
    const studentB = await signedIn(app, w.users.studentB);
    const draft = await studentB.put(`${A}/assignments/${id}/my-submission/draft`, { text: 'done' });
    await studentB.post(`${A}/assignments/${id}/my-submission/submit`, { expectedRev: draft.body.rev });

    const now = new Date();
    expect(await sendDeadlineReminders(now)).toBe(1); // only student A, only the 1-hour reminder
    expect(await sendDeadlineReminders(now)).toBe(0); // retries never resend
    const reminder = await Notification.findOne({ type: 'deadline_reminder' });
    expect(reminder?.userId.toString()).toBe(w.users.studentA._id.toString());
    expect(reminder?.title).toContain('Due in 1 hour');

    // An extension moves student A's reminders to the new deadline.
    await ExtensionRequest.create({
      orgId: w.orgA._id,
      courseId: w.course._id,
      assignmentId: id,
      studentId: w.users.studentA._id,
      reason: 'x',
      requestedDueAt: new Date(now.getTime() + 2 * 86_400_000),
      originalDueAt: dueAt,
      status: 'approved',
      approvedDueAt: new Date(now.getTime() + 2 * 86_400_000),
      decidedAt: now,
    });
    expect(await sendDeadlineReminders(now)).toBe(0); // 24h window for the new date has not opened
    expect(await sendDeadlineReminders(new Date(now.getTime() + 25 * 3600_000))).toBe(1);
  });

  it('never reminds after the deadline', async () => {
    const { id } = await published();
    const assignment = await Assignment.findById(id);
    expect(await sendDeadlineReminders(new Date((assignment?.dueAt.getTime() ?? 0) + 1000))).toBe(0);
  });
});

describe('outbox reliability', () => {
  it('keeps the submission when email delivery fails and retries independently', async () => {
    const { id } = await published();
    const real = emailProvider();
    let calls = 0;
    const failing: EmailProvider = {
      name: 'failing',
      healthCheck: async () => false,
      send: async () => {
        calls += 1;
        throw new Error('SMTP unavailable');
      },
    };
    setEmailProvider(failing);
    try {
      const student = await signedIn(app, w.users.studentA);
      const draft = await student.put(`${A}/assignments/${id}/my-submission/draft`, { text: 'answer' });
      const res = await student.post(`${A}/assignments/${id}/my-submission/submit`, {
        expectedRev: draft.body.rev,
      });
      expect(res.status).toBe(201);
      await drainOutbox();
      expect(calls).toBeGreaterThan(0);
      expect(await SubmissionVersion.countDocuments({ assignmentId: id })).toBe(1);
      expect(
        await Notification.countDocuments({ type: 'submission_confirmed', userId: w.users.studentA._id }),
      ).toBe(1);
      const pending = await OutboxEvent.findOne({ type: 'email.send', status: 'pending' });
      expect(pending?.attempts).toBe(1);
      expect(pending?.availableAt.getTime()).toBeGreaterThan(Date.now());
    } finally {
      setEmailProvider(real);
    }
    await OutboxEvent.updateMany({ status: 'pending' }, { $set: { availableAt: new Date(0) } });
    await flushOutbox();
    expect(await OutboxEvent.countDocuments({ type: 'email.send', status: 'pending' })).toBe(0);
    const delivered = await OutboxEvent.findOne({ type: 'email.send', status: 'done' });
    expect(delivered?.payload).toEqual({ scrubbed: true });
  });

  it('dead-letters events that keep failing and ignores duplicate enqueues', async () => {
    await enqueue('unknown.event', { a: 1 }, { dedupeKey: 'only-once', maxAttempts: 1 });
    await enqueue('unknown.event', { a: 1 }, { dedupeKey: 'only-once', maxAttempts: 1 });
    expect(await OutboxEvent.countDocuments({ dedupeKey: 'only-once' })).toBe(1);
    await drainOutbox();
    expect((await OutboxEvent.findOne({ dedupeKey: 'only-once' }))?.status).toBe('dead');
  });

  it('reclaims events abandoned by a crashed worker', async () => {
    await enqueue(
      'assignment.published',
      { assignmentId: '000000000000000000000000' },
      { dedupeKey: 'crashed' },
    );
    await OutboxEvent.updateOne(
      { dedupeKey: 'crashed' },
      { $set: { status: 'processing', lockedUntil: new Date(Date.now() - 1000), lockedBy: 'dead-host:1' } },
    );
    await drainOutbox();
    expect((await OutboxEvent.findOne({ dedupeKey: 'crashed' }))?.status).toBe('done');
  });
});

describe('file reconciliation', () => {
  it('removes abandoned uploads but keeps files referenced by drafts or versions', async () => {
    const { id } = await published();
    const student = await signedIn(app, w.users.studentA);
    const kept = await student.upload(`${A}/assignments/${id}/my-submission/files`, 'kept.pdf', PDF);
    const orphan = await student.upload(`${A}/assignments/${id}/my-submission/files`, 'orphan.pdf', PDF);
    await student.put(`${A}/assignments/${id}/my-submission/draft`, { fileIds: [kept.body.id] });
    // createdAt is immutable through Mongoose, so backdate via the driver.
    await FileObject.collection.updateMany(
      { ownerId: w.users.studentA._id },
      { $set: { createdAt: new Date(Date.now() - 48 * 3600_000) } },
    );
    expect(await cleanupOrphanFiles()).toBe(1);
    const orphanDoc = await FileObject.findById(orphan.body.id);
    expect(orphanDoc?.status).toBe('deleted');
    expect(await storage().exists(orphanDoc?.storageKey ?? '')).toBe(false);
    expect((await FileObject.findById(kept.body.id))?.status).toBe('pending');
  });
});
