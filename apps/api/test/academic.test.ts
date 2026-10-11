import type { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  Assignment,
  AuditLog,
  GradeHistory,
  Notification,
  Submission,
  SubmissionVersion,
} from '../src/models';
import {
  assignmentInput,
  buildWorld,
  flushOutbox,
  PDF,
  signedIn,
  startTestApp,
  stopTestApp,
  type Client,
  type World,
} from './helpers';

let app: Express;
let w: World;
let teacher: Client;
let studentA: Client;
let studentB: Client;
let base: string;

beforeAll(async () => {
  app = await startTestApp();
});
afterAll(stopTestApp);

beforeEach(async () => {
  w = await buildWorld();
  teacher = await signedIn(app, w.users.teacherA);
  studentA = await signedIn(app, w.users.studentA);
  studentB = await signedIn(app, w.users.studentB);
  base = `/orgs/${w.orgA._id.toString()}`;
});

async function createAndPublish(overrides = {}) {
  const created = await teacher.post(
    `${base}/courses/${w.course._id.toString()}/assignments`,
    assignmentInput(overrides),
  );
  expect(created.status).toBe(201);
  const published = await teacher.post(`${base}/assignments/${created.body.id}/publish`, {
    expectedRev: created.body.rev,
  });
  expect(published.status).toBe(200);
  return published.body as { id: string; rev: number };
}

async function saveAndSubmit(
  client: Client,
  assignmentId: string,
  text = 'My answer',
  key = `key-${Math.random().toString(36).slice(2, 12)}`,
) {
  const current = await client.get(`${base}/assignments/${assignmentId}/my-submission`);
  const draft = await client.put(`${base}/assignments/${assignmentId}/my-submission/draft`, {
    text,
    ...(current.body.id ? { expectedRev: current.body.rev } : {}),
  });
  expect(draft.status).toBe(200);
  return client
    .post(`${base}/assignments/${assignmentId}/my-submission/submit`, { expectedRev: draft.body.rev })
    .set('idempotency-key', key);
}

describe('assignment lifecycle and visibility', () => {
  it('hides drafts from students and notifies recipients on publication', async () => {
    const created = await teacher.post(
      `${base}/courses/${w.course._id.toString()}/assignments`,
      assignmentInput(),
    );
    expect((await studentA.get(`${base}/assignments/${created.body.id}`)).status).toBe(404);
    const list = await studentA.get(`${base}/assignments`);
    expect(list.body.items).toHaveLength(0);
    await teacher.post(`${base}/assignments/${created.body.id}/publish`, { expectedRev: created.body.rev });
    await flushOutbox();
    expect(
      await Notification.countDocuments({ userId: w.users.studentA._id, type: 'assignment_published' }),
    ).toBe(1);
    const visible = await studentA.get(`${base}/assignments`);
    expect(visible.body.items[0]).toMatchObject({
      id: created.body.id,
      my: { displayStatus: 'not_started' },
    });
    // Re-processing the same event does not duplicate notifications.
    await flushOutbox();
    expect(
      await Notification.countDocuments({ userId: w.users.studentA._id, type: 'assignment_published' }),
    ).toBe(1);
  });

  it('enforces optimistic concurrency and records material changes', async () => {
    const asg = await createAndPublish();
    const stale = await teacher.patch(`${base}/assignments/${asg.id}`, {
      expectedRev: asg.rev - 1,
      title: 'X',
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale_revision');
    const newDue = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const updated = await teacher.patch(`${base}/assignments/${asg.id}`, {
      expectedRev: asg.rev,
      dueAt: newDue,
      changeNote: 'More time',
    });
    expect(updated.status).toBe(200);
    await flushOutbox();
    expect(
      await Notification.countDocuments({ userId: w.users.studentA._id, type: 'deadline_changed' }),
    ).toBe(1);
    const changes = await teacher.get(`${base}/assignments/${asg.id}/changes`);
    expect(changes.body.items[0]).toMatchObject({
      kind: 'updated',
      changedFields: ['dueAt'],
      note: 'More time',
    });
  });

  it('rejects invalid transitions and publishing with a past due date', async () => {
    const asg = await createAndPublish();
    const again = await teacher.post(`${base}/assignments/${asg.id}/publish`, { expectedRev: asg.rev });
    expect(again.status).toBe(409);
    const draft = await teacher.post(
      `${base}/courses/${w.course._id.toString()}/assignments`,
      assignmentInput({ dueAt: new Date(Date.now() + 1000).toISOString() }),
    );
    await new Promise((r) => setTimeout(r, 1100));
    const past = await teacher.post(`${base}/assignments/${draft.body.id}/publish`, {
      expectedRev: draft.body.rev,
    });
    expect(past.status).toBe(400);
    expect(past.body.error.code).toBe('due_in_past');
  });

  it('section targeting limits recipients', async () => {
    const section = await teacher.post(`${base}/courses/${w.course._id.toString()}/sections`, {
      name: 'Section 1',
    });
    const roster = await teacher.get(`${base}/courses/${w.course._id.toString()}/roster?q=Student A`);
    await teacher.patch(`${base}/courses/${w.course._id.toString()}/enrollments/${roster.body.items[0].id}`, {
      sectionId: section.body.id,
    });
    const asg = await createAndPublish({ sectionIds: [section.body.id] });
    expect((await studentA.get(`${base}/assignments/${asg.id}`)).status).toBe(200);
    expect((await studentB.get(`${base}/assignments/${asg.id}`)).status).toBe(404);
  });

  it('duplicates into another course only when the caller teaches it', async () => {
    const asg = await createAndPublish();
    const denied = await teacher.post(`${base}/assignments/${asg.id}/duplicate`, {
      targetCourseId: w.otherCourse._id.toString(),
    });
    expect(denied.status).toBe(404);
    const copy = await teacher.post(`${base}/assignments/${asg.id}/duplicate`, {});
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject({ status: 'draft', title: 'Essay on distributed systems (copy)' });
  });
});

describe('submission engine', () => {
  it('saves drafts without submitting, then submits idempotently with a receipt', async () => {
    const asg = await createAndPublish();
    const draft = await studentA.put(`${base}/assignments/${asg.id}/my-submission/draft`, {
      text: 'First thoughts',
    });
    expect(draft.body).toMatchObject({ state: 'draft', displayStatus: 'draft', canSubmit: true });
    const teacherInbox = await teacher.get(`${base}/assignments/${asg.id}/submissions?status=submitted`);
    expect(teacherInbox.body.total).toBe(0); // drafts are not submissions

    const key = 'retry-safe-key-123';
    const first = await studentA
      .post(`${base}/assignments/${asg.id}/my-submission/submit`, { expectedRev: draft.body.rev })
      .set('idempotency-key', key);
    expect(first.status).toBe(201);
    expect(first.body.receiptCode).toMatch(/^SAT-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const retry = await studentA
      .post(`${base}/assignments/${asg.id}/my-submission/submit`, { expectedRev: draft.body.rev })
      .set('idempotency-key', key);
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.receiptCode).toBe(first.body.receiptCode);
    expect(await SubmissionVersion.countDocuments({ assignmentId: asg.id })).toBe(1);

    const reuse = await studentA
      .post(`${base}/assignments/${asg.id}/my-submission/submit`, { expectedRev: 999 })
      .set('idempotency-key', key);
    expect(reuse.status).toBe(400);
    expect(reuse.body.error.code).toBe('idempotency_key_reuse');

    const second = await studentA
      .post(`${base}/assignments/${asg.id}/my-submission/submit`, { expectedRev: draft.body.rev + 1 })
      .set('idempotency-key', 'another-key-456');
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('already_submitted');
    await flushOutbox();
    expect(
      await Notification.countDocuments({ userId: w.users.studentA._id, type: 'submission_confirmed' }),
    ).toBe(1);
    expect(
      await Notification.countDocuments({ userId: w.users.teacherA._id, type: 'submission_received' }),
    ).toBe(1);
  });

  it('rejects content types the assignment does not accept and empty submissions', async () => {
    const asg = await createAndPublish({ submissionMethods: { text: false, file: true, url: false } });
    const res = await studentA.put(`${base}/assignments/${asg.id}/my-submission/draft`, {
      text: 'not allowed',
    });
    expect(res.status).toBe(400);
    const empty = await studentA.put(`${base}/assignments/${asg.id}/my-submission/draft`, {});
    const submit = await studentA.post(`${base}/assignments/${asg.id}/my-submission/submit`, {
      expectedRev: empty.body.rev,
    });
    expect(submit.status).toBe(400);
    expect(submit.body.error.code).toBe('submission_incomplete');
  });

  it('validates uploads by extension and content, and authorizes downloads', async () => {
    const asg = await createAndPublish();
    const path = `${base}/assignments/${asg.id}/my-submission/files`;
    expect((await studentA.upload(path, 'virus.exe', Buffer.from('MZ...'))).status).toBe(400);
    const spoofed = await studentA.upload(
      path,
      'essay.pdf',
      Buffer.from('<html><script>alert(1)</script></html>'),
    );
    expect(spoofed.body.error.code).toBe('file_content_mismatch');
    const traversal = await studentA.upload(path, '../../etc/passwd.txt', Buffer.from('plain text'));
    expect(traversal.status).toBe(201);
    expect(traversal.body.name).toBe('passwd.txt');
    const pdf = await studentA.upload(path, 'essay.pdf', PDF);
    expect(pdf.status).toBe(201);
    expect(pdf.body.mimeType).toBe('application/pdf');

    // Another student cannot attach or download it.
    const steal = await studentB.put(`${base}/assignments/${asg.id}/my-submission/draft`, {
      fileIds: [pdf.body.id],
    });
    expect(steal.status).toBe(400);
    expect((await studentB.get(`/files/${pdf.body.id}/download`)).status).toBe(404);
    // The teacher cannot see unsent uploads either.
    expect((await teacher.get(`/files/${pdf.body.id}/download`)).status).toBe(404);

    const draft = await studentA.put(`${base}/assignments/${asg.id}/my-submission/draft`, {
      fileIds: [pdf.body.id],
    });
    await studentA.post(`${base}/assignments/${asg.id}/my-submission/submit`, {
      expectedRev: draft.body.rev,
    });
    const own = await studentA.get(`/files/${pdf.body.id}/download`);
    expect(own.status).toBe(200);
    expect(own.headers['content-disposition']).toMatch(/^attachment/);
    expect(own.headers['x-content-type-options']).toBe('nosniff');
    expect((await teacher.get(`/files/${pdf.body.id}/download`)).status).toBe(200);
    expect((await studentB.get(`/files/${pdf.body.id}/download`)).status).toBe(404);
    const otherTeacher = await signedIn(app, w.users.teacherA2);
    expect((await otherTeacher.get(`/files/${pdf.body.id}/download`)).status).toBe(404);
    const admin = await signedIn(app, w.users.adminA);
    expect((await admin.get(`/files/${pdf.body.id}/download`)).status).toBe(404);
    expect(
      (await admin.get(`/files/${pdf.body.id}/download?reason=Academic%20integrity%20review`)).status,
    ).toBe(200);
    expect(await AuditLog.exists({ action: 'admin.file_accessed' })).toBeTruthy();
  });

  it('applies the late policy against server time', async () => {
    const asg = await createAndPublish({
      latePolicy: { mode: 'accept', penaltyPercentPerDay: 10, maxLateDays: 2 },
    });
    await Assignment.updateOne({ _id: asg.id }, { $set: { dueAt: new Date(Date.now() - 60 * 60_000) } });
    const res = await saveAndSubmit(studentA, asg.id);
    expect(res.status).toBe(201);
    expect(res.body.isLate).toBe(true);

    const strict = await createAndPublish();
    await Assignment.updateOne({ _id: strict.id }, { $set: { dueAt: new Date(Date.now() - 60_000) } });
    const blocked = await saveAndSubmit(studentA, strict.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('submissions_closed');
  });

  it('follows the resubmission policy and supports withdrawal', async () => {
    const asg = await createAndPublish({ resubmission: { allowed: true, maxAttempts: 2 } });
    expect((await saveAndSubmit(studentA, asg.id, 'v1')).status).toBe(201);
    const second = await saveAndSubmit(studentA, asg.id, 'v2');
    expect(second.status).toBe(201);
    expect(second.body.attemptNumber).toBe(2);
    const third = await saveAndSubmit(studentA, asg.id, 'v3');
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe('attempts_exhausted');
    const versions = await studentA.get(`${base}/assignments/${asg.id}/my-submission/versions`);
    expect(versions.body.map((v: { text: string }) => v.text)).toEqual(['v2', 'v1']);

    const single = await createAndPublish();
    await saveAndSubmit(studentB, single.id, 'mine');
    const mine = await studentB.get(`${base}/assignments/${single.id}/my-submission`);
    expect(mine.body.canWithdraw).toBe(true);
    const withdrawn = await studentB.post(`${base}/assignments/${single.id}/my-submission/withdraw`, {
      expectedRev: mine.body.rev,
    });
    expect(withdrawn.body).toMatchObject({ state: 'withdrawn', canSubmit: true });
  });
});

describe('grading and feedback', () => {
  it('keeps drafts private, publishes, and requires a reason for corrections', async () => {
    const asg = await createAndPublish();
    const receipt = await saveAndSubmit(studentA, asg.id);
    const subId = receipt.body.submissionId;

    const tooHigh = await teacher.put(`${base}/submissions/${subId}/grade`, { points: 26, feedback: 'x' });
    expect(tooHigh.status).toBe(400);
    const draft = await teacher.put(`${base}/submissions/${subId}/grade`, {
      points: 20,
      feedback: 'Good work',
      privateNotes: 'borderline',
    });
    expect(draft.status).toBe(200);
    const view = await studentA.get(`${base}/assignments/${asg.id}/my-submission`);
    expect(view.body.grade).toBeNull();
    expect(JSON.stringify(view.body)).not.toContain('borderline');

    // Students cannot grade, even themselves.
    expect((await studentA.put(`${base}/submissions/${subId}/grade`, { points: 25 })).status).toBe(404);
    expect((await studentA.post(`${base}/submissions/${subId}/grade/publish`, {})).status).toBe(404);

    const published = await teacher.post(`${base}/submissions/${subId}/grade/publish`, {});
    expect(published.status).toBe(200);
    const released = await studentA.get(`${base}/assignments/${asg.id}/my-submission`);
    expect(released.body.grade).toMatchObject({ finalPoints: 20, maxPoints: 25, feedback: 'Good work' });
    expect(JSON.stringify(released.body)).not.toContain('borderline');
    expect(released.body.displayStatus).toBe('graded');

    await teacher.put(`${base}/submissions/${subId}/grade`, { points: 22, feedback: 'Regraded' });
    const noReason = await teacher.post(`${base}/submissions/${subId}/grade/publish`, {});
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.code).toBe('reason_required');
    // Until the correction is published the student still sees the original grade.
    expect((await studentA.get(`${base}/assignments/${asg.id}/my-submission`)).body.grade.finalPoints).toBe(
      20,
    );
    expect(
      (await teacher.post(`${base}/submissions/${subId}/grade/publish`, { reason: 'Missed rubric item' }))
        .status,
    ).toBe(200);
    const history = await teacher.get(`${base}/submissions/${subId}/grade-history`);
    expect(history.body.map((h: { action: string }) => h.action)).toEqual(['correct', 'publish']);
    expect(history.body[0]).toMatchObject({
      previousFinalPoints: 20,
      newFinalPoints: 22,
      reason: 'Missed rubric item',
    });
    await flushOutbox();
    expect(await Notification.countDocuments({ userId: w.users.studentA._id, type: 'grade_published' })).toBe(
      2,
    );
  });

  it('applies late penalties and rubric limits', async () => {
    const rubric = await teacher.post(`${base}/rubrics`, {
      title: 'Essay rubric',
      criteria: [
        { id: 'arg', title: 'Argument', maxPoints: 15 },
        { id: 'style', title: 'Style', maxPoints: 10 },
      ],
    });
    expect(rubric.status).toBe(201);
    const asg = await createAndPublish({
      rubricId: rubric.body.id,
      latePolicy: { mode: 'penalize', penaltyPercentPerDay: 10, maxLateDays: null },
    });
    await Assignment.updateOne({ _id: asg.id }, { $set: { dueAt: new Date(Date.now() - 2 * 60_000) } });
    const receipt = await saveAndSubmit(studentA, asg.id);
    const over = await teacher.put(`${base}/submissions/${receipt.body.submissionId}/grade`, {
      rubricScores: [
        { criterionId: 'arg', points: 16 },
        { criterionId: 'style', points: 5 },
      ],
    });
    expect(over.status).toBe(400);
    const ok = await teacher.put(`${base}/submissions/${receipt.body.submissionId}/grade`, {
      rubricScores: [
        { criterionId: 'arg', points: 15 },
        { criterionId: 'style', points: 5 },
      ],
    });
    expect(ok.body.draft).toMatchObject({ rawPoints: 20, latePenaltyPoints: 2, finalPoints: 18 });
    // Editing a rubric that has been used for grading is blocked; snapshots stay intact.
    const edit = await teacher.patch(`${base}/rubrics/${rubric.body.id}`, {
      expectedRev: rubric.body.rev,
      criteria: [{ title: 'Only', maxPoints: 25 }],
    });
    expect(edit.status).toBe(409);
  });

  it('keeps a rubric total equal to the points of assignments that use it', async () => {
    const rubric = await teacher.post(`${base}/rubrics`, {
      title: 'Ten-point rubric',
      criteria: [{ id: 'all', title: 'Overall', maxPoints: 10 }],
    });
    expect(rubric.status).toBe(201);
    const course = `${base}/courses/${w.course._id.toString()}/assignments`;
    // 25-point assignment with a 10-point rubric: full rubric marks would only ever reach 40%.
    const mismatch = await teacher.post(course, assignmentInput({ rubricId: rubric.body.id, maxPoints: 25 }));
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.code).toBe('rubric_points_mismatch');
    expect(mismatch.body.error.fields.maxPoints[0]).toContain('10');

    const created = await teacher.post(course, assignmentInput({ rubricId: rubric.body.id, maxPoints: 10 }));
    expect(created.status).toBe(201);
    const pointsOnly = await teacher.patch(`${base}/assignments/${created.body.id}`, {
      expectedRev: created.body.rev,
      maxPoints: 20,
    });
    expect(pointsOnly.status).toBe(400);
    expect(pointsOnly.body.error.code).toBe('rubric_points_mismatch');

    // Changing the rubric so it no longer matches an assignment that uses it is refused with a clear reason.
    const grow = await teacher.patch(`${base}/rubrics/${rubric.body.id}`, {
      expectedRev: rubric.body.rev,
      criteria: [{ title: 'Overall', maxPoints: 12 }],
    });
    expect(grow.status).toBe(409);
    expect(grow.body.error.code).toBe('rubric_points_mismatch');
    // Points and rubric changed together stay consistent.
    const both = await teacher.patch(`${base}/assignments/${created.body.id}`, {
      expectedRev: created.body.rev,
      maxPoints: 30,
      rubricId: null,
    });
    expect(both.status).toBe(200);
  });

  it('holds published grades until release when configured', async () => {
    const asg = await createAndPublish({ gradeRelease: 'hold' });
    const receipt = await saveAndSubmit(studentA, asg.id);
    await teacher.put(`${base}/submissions/${receipt.body.submissionId}/grade`, { points: 10 });
    await teacher.post(`${base}/assignments/${asg.id}/grades/publish-all`, {});
    expect((await studentA.get(`${base}/assignments/${asg.id}/my-submission`)).body.grade).toBeNull();
    const exported = await studentA.get('/me/export');
    expect(exported.body.grades).toHaveLength(0);
    await teacher.post(`${base}/assignments/${asg.id}/grades/release`, {});
    expect((await studentA.get(`${base}/assignments/${asg.id}/my-submission`)).body.grade.finalPoints).toBe(
      10,
    );
  });

  it('returns work for revision and lets the student resubmit', async () => {
    const asg = await createAndPublish();
    const receipt = await saveAndSubmit(studentA, asg.id, 'v1');
    const returned = await teacher.post(`${base}/submissions/${receipt.body.submissionId}/return`, {
      feedback: 'Expand section 2',
    });
    expect(returned.status).toBe(200);
    const view = await studentA.get(`${base}/assignments/${asg.id}/my-submission`);
    expect(view.body).toMatchObject({
      state: 'returned',
      displayStatus: 'returned',
      returnFeedback: 'Expand section 2',
      canSubmit: true,
    });
    const resubmit = await saveAndSubmit(studentA, asg.id, 'v2');
    expect(resubmit.status).toBe(201);
    expect(resubmit.body.attemptNumber).toBe(2);
    expect(
      await GradeHistory.countDocuments({ submissionId: receipt.body.submissionId, action: 'return' }),
    ).toBe(1);
  });
});

describe('extensions', () => {
  it('approved extensions change deadline enforcement for that student only', async () => {
    const asg = await createAndPublish({ extensionsAllowed: true });
    const requested = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const req = await studentA.post(`${base}/assignments/${asg.id}/extension-requests`, {
      requestedDueAt: requested,
      reason: 'Medical',
    });
    expect(req.status).toBe(201);
    const dup = await studentA.post(`${base}/assignments/${asg.id}/extension-requests`, {
      requestedDueAt: requested,
      reason: 'Again',
    });
    expect(dup.status).toBe(409);
    expect(
      (await studentB.post(`${base}/extension-requests/${req.body.id}/decide`, { decision: 'approve' }))
        .status,
    ).toBe(404);
    const decided = await teacher.post(`${base}/extension-requests/${req.body.id}/decide`, {
      decision: 'approve',
      note: 'Get well soon',
    });
    expect(decided.body.status).toBe('approved');

    // Move the original deadline into the past: only student A may still submit on time.
    await Assignment.updateOne({ _id: asg.id }, { $set: { dueAt: new Date(Date.now() - 60_000) } });
    const a = await saveAndSubmit(studentA, asg.id);
    expect(a.status).toBe(201);
    expect(a.body.isLate).toBe(false);
    const b = await saveAndSubmit(studentB, asg.id);
    expect(b.status).toBe(409);
    const detail = await studentA.get(`${base}/assignments/${asg.id}`);
    expect(detail.body.my.extensionDueAt).toBe(new Date(requested).toISOString());
    await flushOutbox();
    expect(
      await Notification.countDocuments({ userId: w.users.studentA._id, type: 'extension_decided' }),
    ).toBe(1);
  });

  it('rejects requests when the assignment does not allow them', async () => {
    const asg = await createAndPublish();
    const res = await studentA.post(`${base}/assignments/${asg.id}/extension-requests`, {
      requestedDueAt: new Date(Date.now() + 9 * 86_400_000).toISOString(),
      reason: 'x',
    });
    expect(res.status).toBe(403);
  });
});

describe('inbox and analytics', () => {
  it('lists every recipient with status and computes stats from records', async () => {
    const asg = await createAndPublish();
    await saveAndSubmit(studentA, asg.id);
    const inbox = await teacher.get(`${base}/assignments/${asg.id}/submissions`);
    expect(inbox.body.total).toBe(2);
    const statuses = Object.fromEntries(
      inbox.body.items.map((r: { name: string; displayStatus: string }) => [r.name, r.displayStatus]),
    );
    expect(statuses).toEqual({ 'Student A': 'submitted', 'Student B': 'not_started' });
    const stats = await teacher.get(`${base}/assignments/${asg.id}/stats`);
    expect(stats.body).toMatchObject({ targeted: 2, submitted: 1, notSubmitted: 1, late: 0 });
    const dash = await teacher.get(`${base}/dashboard/teacher`);
    expect(dash.body).toMatchObject({ coursesTaught: 1, pendingGrading: 1 });
    const sdash = await studentB.get(`${base}/dashboard/student`);
    expect(sdash.body.counts).toMatchObject({ pending: 1, dueSoon: 1 });
    const report = await teacher.get(`${base}/courses/${w.course._id.toString()}/report`);
    expect(report.body.assignments[0]).toMatchObject({ targeted: 2, submitted: 1, completionRate: 50 });
    expect((await studentA.get(`${base}/courses/${w.course._id.toString()}/report`)).status).toBe(404);
  });

  it('exports a calendar with effective deadlines', async () => {
    await createAndPublish();
    const ics = await studentA.get(`${base}/calendar.ics`);
    expect(ics.status).toBe(200);
    expect(ics.text).toContain('BEGIN:VCALENDAR');
    expect(ics.text).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const events = await studentA.get(
      `${base}/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(events.body).toHaveLength(1);
  });
});

describe('concurrency', () => {
  it('concurrent first drafts produce exactly one submission record', async () => {
    const asg = await createAndPublish();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        studentA.put(`${base}/assignments/${asg.id}/my-submission/draft`, { text: 'race' }),
      ),
    );
    expect(results.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true);
    expect(await Submission.countDocuments({ assignmentId: asg.id, studentId: w.users.studentA._id })).toBe(
      1,
    );
  });
});
