import type { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Enrollment, Invitation, Membership, Notification, Organization, User } from '../src/models';
import {
  buildWorld,
  Client,
  createUser,
  flushOutbox,
  mailbox,
  PASSWORD,
  signedIn,
  startTestApp,
  stopTestApp,
  tokenFromEmail,
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

describe('invitations', () => {
  it('invites a new person into a course; they register from the emailed link and are enrolled', async () => {
    const teacher = await signedIn(app, w.users.teacherA);
    const email = `newcomer.${Date.now()}@example.edu`;
    const res = await teacher.post(`${A}/courses/${w.course._id.toString()}/enrollments`, { email });
    expect(res.status).toBe(202);
    expect(res.body.invited).toBe(true);
    await flushOutbox();
    const token = tokenFromEmail(email, '/accept-invite');
    const visitor = await new Client(app).init();
    const preview = await visitor.post('/invitations/preview', { token });
    expect(preview.body).toMatchObject({ role: 'student', email, accountExists: false });
    const reg = await visitor.post('/auth/register', {
      name: 'Newcomer',
      email,
      password: PASSWORD,
      invitationToken: token,
    });
    expect(reg.status).toBe(201);
    const user = await User.findOne({ email });
    expect(
      await Enrollment.exists({
        courseId: w.course._id,
        userId: user?._id,
        role: 'student',
        status: 'active',
      }),
    ).toBeTruthy();
  });

  it('existing users accept pending invitations in-app and roles are never downgraded', async () => {
    const admin = await signedIn(app, w.users.adminA);
    const outsider = await createUser();
    await admin.post(`${A}/invitations`, { email: outsider.email, role: 'teacher' });
    const client = await signedIn(app, outsider);
    const pending = await client.get('/me/invitations');
    expect(pending.body).toHaveLength(1);
    const accepted = await client.post(`/me/invitations/${pending.body[0].id}/accept`);
    expect(accepted.body).toMatchObject({ role: 'teacher' });
    // A later student invitation (e.g. from a course roster) does not downgrade the teacher.
    await admin.post(`${A}/invitations`, {
      email: outsider.email,
      role: 'student',
      courseId: w.course._id.toString(),
    });
    const again = await client.get('/me/invitations');
    await client.post(`/me/invitations/${again.body[0].id}/accept`);
    expect((await Membership.findOne({ orgId: w.orgA._id, userId: outsider._id }))?.role).toBe('teacher');
  });

  it('revoked and expired invitations cannot be used', async () => {
    const admin = await signedIn(app, w.users.adminA);
    const email = 'revoked@example.edu';
    const inv = await admin.post(`${A}/invitations`, { email, role: 'student' });
    await flushOutbox();
    const token = tokenFromEmail(email, '/accept-invite');
    await admin.post(`${A}/invitations/${inv.body.id}/revoke`);
    const visitor = await new Client(app).init();
    expect(
      (await visitor.post('/auth/register', { name: 'R', email, password: PASSWORD, invitationToken: token }))
        .status,
    ).toBe(400);
    await Invitation.create({
      orgId: w.orgA._id,
      email: 'late@example.edu',
      role: 'student',
      tokenHash: 'x'.repeat(64),
      expiresAt: new Date(Date.now() - 1000),
    });
    const list = await admin.get(`${A}/invitations?status=expired`);
    expect(list.body.items.some((i: { email: string }) => i.email === 'late@example.edu')).toBe(true);
  });
});

describe('courses and roster', () => {
  it('teachers create courses (when allowed) and become instructor', async () => {
    const teacher = await signedIn(app, w.users.teacherA2);
    const res = await teacher.post(`${A}/courses`, { code: 'bio101', title: 'Biology', term: '2026-T1' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ code: 'BIO101', myRole: 'instructor' });
    const dup = await teacher.post(`${A}/courses`, {
      code: 'BIO101',
      title: 'Biology again',
      term: '2026-T1',
    });
    expect(dup.status).toBe(409);
    await Organization.updateOne(
      { _id: w.orgA._id },
      { $set: { 'settings.teachersCanCreateCourses': false } },
    );
    expect(
      (await teacher.post(`${A}/courses`, { code: 'CHEM1', title: 'Chem', term: '2026-T1' })).status,
    ).toBe(403);
  });

  it('previews and commits a CSV roster import without silently dropping invalid rows', async () => {
    const teacher = await signedIn(app, w.users.teacherA);
    const path = `${A}/courses/${w.course._id.toString()}/roster-import`;
    const bad = `email,name,role\nnot-an-email,X,student\n${w.users.studentA.email},A,student\n`;
    const preview = await teacher.post(`${path}/preview`, { csv: bad });
    expect(preview.status).toBe(200);
    expect(preview.body.summary).toMatchObject({ total: 2, errors: 1, skipped: 1 });
    const blocked = await teacher.post(`${path}/commit`, { csv: bad, contentHash: preview.body.contentHash });
    expect(blocked.status).toBe(400);

    const someone = await createUser();
    await Membership.create({
      orgId: w.orgA._id,
      userId: someone._id,
      role: 'student',
      status: 'active',
      joinedAt: new Date(),
    });
    const good = `Email,Name\n${someone.email},Someone\nfresh.person@example.edu,Fresh\nfresh.person@example.edu,Dup\n`;
    const p2 = await teacher.post(`${path}/preview`, { csv: good });
    expect(p2.body.summary).toMatchObject({ enroll: 1, invite: 1, skipped: 1, errors: 0 });
    const tampered = await teacher.post(`${path}/commit`, {
      csv: `${good}x@y.edu,Z\n`,
      contentHash: p2.body.contentHash,
    });
    expect(tampered.status).toBe(409);
    const commit = await teacher.post(`${path}/commit`, { csv: good, contentHash: p2.body.contentHash });
    expect(commit.status).toBe(200);
    expect(
      await Enrollment.exists({ courseId: w.course._id, userId: someone._id, status: 'active' }),
    ).toBeTruthy();
    expect(
      await Invitation.exists({
        email: 'fresh.person@example.edu',
        courseId: w.course._id,
        status: 'pending',
      }),
    ).toBeTruthy();
  });

  it('exports the roster as CSV with formula injection neutralised', async () => {
    const evil = await createUser({ name: '=HYPERLINK("http://evil")' });
    await Membership.create({
      orgId: w.orgA._id,
      userId: evil._id,
      role: 'student',
      status: 'active',
      joinedAt: new Date(),
    });
    await Enrollment.create({
      orgId: w.orgA._id,
      courseId: w.course._id,
      userId: evil._id,
      role: 'student',
      status: 'active',
      enrolledAt: new Date(),
    });
    const teacher = await signedIn(app, w.users.teacherA);
    const res = await teacher.get(`${A}/courses/${w.course._id.toString()}/roster.csv`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });

  it('archived courses are read-only', async () => {
    const teacher = await signedIn(app, w.users.teacherA);
    await teacher.post(`${A}/courses/${w.course._id.toString()}/archive`);
    const res = await teacher.patch(`${A}/courses/${w.course._id.toString()}`, { title: 'Changed' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('course_archived');
  });
});

describe('membership administration', () => {
  it('suspending a member revokes their sessions and access', async () => {
    const admin = await signedIn(app, w.users.adminA);
    const student = await signedIn(app, w.users.studentA);
    const m = await Membership.findOne({ orgId: w.orgA._id, userId: w.users.studentA._id });
    expect((await admin.patch(`${A}/members/${m?._id.toString()}`, { status: 'suspended' })).status).toBe(
      200,
    );
    expect((await student.get('/me')).status).toBe(401);
    const again = await signedIn(app, w.users.studentA);
    expect((await again.get(`${A}/assignments`)).status).toBe(404);
  });

  it('dashboards and audit search use real records', async () => {
    const admin = await signedIn(app, w.users.adminA);
    const dash = await admin.get(`${A}/dashboard/admin`);
    expect(dash.body.members).toMatchObject({ total: 5, students: 2, teachers: 2, admins: 1 });
    expect(dash.body.submissionsByDay).toHaveLength(30);
    await admin.patch(`${A}`, { name: 'Org A Renamed' });
    const audit = await admin.get(`${A}/audit-logs?action=org.`);
    expect(audit.body.items[0]).toMatchObject({ action: 'org.updated' });
    const csv = await admin.get(`${A}/audit-logs.csv`);
    expect(csv.text.split('\r\n')[0]).toContain('time,action,actor');
  });
});

describe('announcements', () => {
  it('targets audiences, records reads and acknowledgements, and hides scheduled posts', async () => {
    const teacher = await signedIn(app, w.users.teacherA);
    const studentA = await signedIn(app, w.users.studentA);
    const outsider = await signedIn(app, w.users.teacherA2);
    const created = await teacher.post(`${A}/announcements`, {
      title: 'Lab moved',
      body: '**Room 4** now',
      audience: 'course',
      courseId: w.course._id.toString(),
      requireAck: true,
    });
    expect(created.status).toBe(201);
    const future = await teacher.post(`${A}/announcements`, {
      title: 'Later',
      body: 'Soon',
      audience: 'course',
      courseId: w.course._id.toString(),
      publishAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(future.body.status).toBe('scheduled');
    const list = await studentA.get(`${A}/announcements`);
    expect(list.body.items.map((a: { title: string }) => a.title)).toEqual(['Lab moved']);
    expect((await outsider.get(`${A}/announcements/${created.body.id}`)).status).toBe(404);
    expect((await studentA.get(`${A}/announcements/${future.body.id}`)).status).toBe(404);
    await studentA.post(`${A}/announcements/${created.body.id}/acknowledge`);
    const stats = await teacher.get(`${A}/announcements/${created.body.id}`);
    expect(stats.body.stats).toEqual({ read: 1, acknowledged: 1 });
    expect(
      (await teacher.post(`${A}/announcements`, { title: 'All', body: 'x', audience: 'org_all' })).status,
    ).toBe(403);
    await flushOutbox();
    expect(await Notification.countDocuments({ userId: w.users.studentA._id, type: 'announcement' })).toBe(1);
    expect(await Notification.countDocuments({ userId: w.users.teacherA._id, type: 'announcement' })).toBe(0);
  });
});

describe('notifications', () => {
  it('lists, counts and marks only the caller’s notifications', async () => {
    const admin = await signedIn(app, w.users.adminA);
    await admin.post(`${A}/invitations`, { email: w.users.studentOrgB.email, role: 'student' });
    await flushOutbox();
    const student = await signedIn(app, w.users.studentOrgB);
    const count = await student.get('/notifications/unread-count');
    expect(count.body.count).toBe(1);
    const list = await student.get('/notifications');
    const other = await signedIn(app, w.users.studentA);
    expect((await other.post(`/notifications/${list.body.items[0].id}/read`)).status).toBe(404);
    expect((await student.post(`/notifications/${list.body.items[0].id}/read`)).status).toBe(204);
    expect((await student.get('/notifications/unread-count')).body.count).toBe(0);
    expect(mailbox().sent.some((m) => m.to === w.users.studentOrgB.email)).toBe(true);
  });

  it('respects notification preferences', async () => {
    const student = await signedIn(app, w.users.studentA);
    const prefs = await student.get('/me/notification-preferences');
    await student.put('/me/notification-preferences', {
      ...prefs.body,
      effectiveReminderOffsetsMinutes: undefined,
      inApp: { ...prefs.body.inApp, enrollment: false },
    });
    const teacher = await signedIn(app, w.users.teacherA2);
    await teacher.post(`${A}/courses/${w.otherCourse._id.toString()}/enrollments`, {
      userId: w.users.studentA._id.toString(),
    });
    await flushOutbox();
    expect(await Notification.countDocuments({ userId: w.users.studentA._id, type: 'enrollment' })).toBe(0);
  });
});

describe('platform administration', () => {
  it('creates organizations with a first admin invitation and manages platform roles with audit', async () => {
    const root = await createUser({ platformRole: 'platform_admin' });
    const client = await signedIn(app, root);
    const created = await client.post('/platform/orgs', {
      name: 'New College',
      slug: 'new-college',
      timezone: 'Europe/London',
      adminEmail: 'dean@newcollege.edu',
    });
    expect(created.status).toBe(201);
    expect(
      (
        await client.post('/platform/orgs', {
          name: 'Dup',
          slug: 'new-college',
          timezone: 'UTC',
          adminEmail: 'x@y.edu',
        })
      ).status,
    ).toBe(409);
    await flushOutbox();
    expect(mailbox().sent.some((m) => m.to === 'dean@newcollege.edu')).toBe(true);
    expect(
      (
        await client.post(`/platform/users/${root._id.toString()}/platform-role`, {
          grant: false,
          reason: 'x',
        })
      ).status,
    ).toBe(403);
    const grant = await client.post(`/platform/users/${w.users.adminA._id.toString()}/platform-role`, {
      grant: true,
      reason: 'On-call rotation',
    });
    expect(grant.status).toBe(200);
    const health = await client.get('/platform/health');
    expect(health.body.checks.database.status).toBe('ok');
    expect(JSON.stringify(health.body)).not.toMatch(/mongodb:\/\//);
    // A platform admin has no implicit access to an organization's academic data.
    expect((await client.get(`${A}/assignments`)).status).toBe(404);
  });
});
