import type { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog, Grade, Membership } from '../src/models';
import {
  api,
  assignmentInput,
  buildWorld,
  Client,
  signedIn,
  startTestApp,
  stopTestApp,
  type World,
} from './helpers';

let app: Express;
let w: World;
let A: string;
let B: string;

beforeAll(async () => {
  app = await startTestApp();
});
afterAll(stopTestApp);
beforeEach(async () => {
  w = await buildWorld();
  A = `/orgs/${w.orgA._id.toString()}`;
  B = `/orgs/${w.orgB._id.toString()}`;
});

async function publishedAssignment() {
  const teacher = await signedIn(app, w.users.teacherA);
  const created = await teacher.post(
    `${A}/courses/${w.course._id.toString()}/assignments`,
    assignmentInput(),
  );
  const published = await teacher.post(`${A}/assignments/${created.body.id}/publish`, {
    expectedRev: created.body.rev,
  });
  return { teacher, assignmentId: published.body.id as string };
}

async function submitAs(client: Client, assignmentId: string) {
  const draft = await client.put(`${A}/assignments/${assignmentId}/my-submission/draft`, { text: 'answer' });
  const res = await client.post(`${A}/assignments/${assignmentId}/my-submission/submit`, {
    expectedRev: draft.body.rev,
  });
  return res.body.submissionId as string;
}

describe('authentication is required', () => {
  it('rejects anonymous access to every protected surface', async () => {
    const anon = new Client(app);
    for (const path of [
      '/me',
      `${A}`,
      `${A}/courses`,
      `${A}/assignments`,
      '/notifications',
      '/platform/orgs',
    ]) {
      expect((await anon.get(path)).status, path).toBe(401);
    }
  });
});

describe('tenant isolation', () => {
  it('an organization administrator cannot read another organization', async () => {
    const adminB = await signedIn(app, w.users.adminB);
    for (const path of [
      `${A}`,
      `${A}/members`,
      `${A}/courses?scope=all`,
      `${A}/audit-logs`,
      `${A}/dashboard/admin`,
      `${A}/courses/${w.course._id.toString()}`,
    ]) {
      const res = await adminB.get(path);
      expect(res.status, path).toBe(404);
    }
  });

  it('identifiers from another tenant are not reachable through the caller’s own organization', async () => {
    const { assignmentId } = await publishedAssignment();
    const adminB = await signedIn(app, w.users.adminB);
    expect((await adminB.get(`${B}/assignments/${assignmentId}`)).status).toBe(404);
    expect((await adminB.get(`${B}/courses/${w.course._id.toString()}/roster`)).status).toBe(404);
    expect((await adminB.post(`${B}/courses/${w.course._id.toString()}/archive`)).status).toBe(404);
  });
});

describe('student isolation', () => {
  it('a student cannot read or modify another student’s submission or grade', async () => {
    const { teacher, assignmentId } = await publishedAssignment();
    const studentA = await signedIn(app, w.users.studentA);
    const studentB = await signedIn(app, w.users.studentB);
    const subA = await submitAs(studentA, assignmentId);
    await teacher.put(`${A}/submissions/${subA}/grade`, { points: 20, feedback: 'private to A' });
    await teacher.post(`${A}/submissions/${subA}/grade/publish`, {});

    expect((await studentB.get(`${A}/submissions/${subA}`)).status).toBe(404);
    expect((await studentB.get(`${A}/submissions/${subA}/grade-history`)).status).toBe(404);
    expect((await studentB.get(`${A}/assignments/${assignmentId}/submissions`)).status).toBe(404);
    const own = await studentB.get(`${A}/assignments/${assignmentId}/my-submission`);
    expect(own.body.id).toBeNull();
    expect(JSON.stringify(own.body)).not.toContain('private to A');
    expect((await studentA.put(`${A}/submissions/${subA}/grade`, { points: 25 })).status).toBe(404);
    expect((await Grade.findOne({ submissionId: subA }))?.published?.finalPoints).toBe(20);
  });

  it('students cannot see the roster, course reports or other courses', async () => {
    const studentA = await signedIn(app, w.users.studentA);
    expect((await studentA.get(`${A}/courses/${w.course._id.toString()}/roster`)).status).toBe(404);
    expect((await studentA.get(`${A}/courses/${w.otherCourse._id.toString()}`)).status).toBe(404);
    expect((await studentA.get(`${A}/members`)).status).toBe(403);
    expect(
      (await studentA.post(`${A}/courses/${w.course._id.toString()}/assignments`, assignmentInput())).status,
    ).toBe(403);
  });
});

describe('teacher boundaries', () => {
  it('a teacher cannot manage an unrelated course or grade its submissions', async () => {
    const teacherA2 = await signedIn(app, w.users.teacherA2);
    const { assignmentId } = await publishedAssignment();
    const subA = await submitAs(await signedIn(app, w.users.studentA), assignmentId);
    expect((await teacherA2.get(`${A}/courses/${w.course._id.toString()}/roster`)).status).toBe(404);
    expect(
      (await teacherA2.patch(`${A}/assignments/${assignmentId}`, { expectedRev: 1, title: 'Hijack' })).status,
    ).toBe(404);
    expect((await teacherA2.get(`${A}/submissions/${subA}`)).status).toBe(404);
    expect((await teacherA2.put(`${A}/submissions/${subA}/grade`, { points: 0 })).status).toBe(404);
    // Bulk publication with foreign submission ids affects nothing outside the assignment.
    const ownCourse = await teacherA2.post(
      `${A}/courses/${w.otherCourse._id.toString()}/assignments`,
      assignmentInput(),
    );
    const bulk = await teacherA2.post(`${A}/assignments/${ownCourse.body.id}/grades/publish-all`, {
      submissionIds: [subA],
    });
    expect(bulk.body.published).toBe(0);
  });

  it('a teacher cannot use an invitation to enroll people into a course they do not teach', async () => {
    const teacherA2 = await signedIn(app, w.users.teacherA2);
    const res = await teacherA2.post(`${A}/invitations`, {
      email: 'smuggled.student@example.edu',
      role: 'student',
      courseId: w.course._id.toString(),
    });
    expect(res.status).toBe(404);
    const own = await teacherA2.post(`${A}/invitations`, {
      email: 'own.student@example.edu',
      role: 'student',
      courseId: w.otherCourse._id.toString(),
    });
    expect(own.status).toBe(201);
  });

  it('a teacher cannot promote themselves or invite administrators', async () => {
    const teacher = await signedIn(app, w.users.teacherA);
    const membership = await Membership.findOne({ orgId: w.orgA._id, userId: w.users.teacherA._id });
    expect(
      (await teacher.patch(`${A}/members/${membership?._id.toString()}`, { role: 'org_admin', reason: 'me' }))
        .status,
    ).toBe(403);
    expect(
      (await teacher.post(`${A}/invitations`, { email: 'friend@example.edu', role: 'org_admin' })).status,
    ).toBe(403);
    expect(
      (await teacher.post(`${A}/invitations`, { email: 'friend@example.edu', role: 'teacher' })).status,
    ).toBe(403);
    expect(
      (await teacher.post(`${A}/invitations`, { email: 'student.new@example.edu', role: 'student' })).status,
    ).toBe(201);
    // Adding a student as course instructor is rejected.
    const add = await teacher.post(`${A}/courses/${w.course._id.toString()}/enrollments`, {
      userId: w.users.studentA._id.toString(),
      role: 'instructor',
    });
    expect(add.status).toBe(400);
    expect((await Membership.findOne({ _id: membership?._id }))?.role).toBe('teacher');
  });

  it('a client-side role claim does not change server permissions', async () => {
    const student = await signedIn(app, w.users.studentA);
    const res = await student.agent
      .get(api(`${A}/members`))
      .set('x-role', 'org_admin')
      .set('Cookie', 'role=org_admin');
    expect([401, 403]).toContain(res.status);
  });
});

describe('administrators', () => {
  it('cannot change their own role, and the last admin cannot be removed', async () => {
    const admin = await signedIn(app, w.users.adminA);
    const own = await Membership.findOne({ orgId: w.orgA._id, userId: w.users.adminA._id });
    expect(
      (await admin.patch(`${A}/members/${own?._id.toString()}`, { role: 'student', reason: 'x' })).status,
    ).toBe(403);
    expect((await admin.delete(`${A}/members/${own?._id.toString()}`, { reason: 'x' })).status).toBe(403);
    const teacherMembership = await Membership.findOne({ orgId: w.orgA._id, userId: w.users.teacherA._id });
    const noReason = await admin.patch(`${A}/members/${teacherMembership?._id.toString()}`, {
      role: 'org_admin',
    });
    expect(noReason.status).toBe(400);
    const promoted = await admin.patch(`${A}/members/${teacherMembership?._id.toString()}`, {
      role: 'org_admin',
      reason: 'Department head',
    });
    expect(promoted.status).toBe(200);
    expect(await AuditLog.exists({ action: 'membership.role_changed' })).toBeTruthy();
  });

  it('do not read submissions without the audited break-glass path', async () => {
    const { assignmentId } = await publishedAssignment();
    const subA = await submitAs(await signedIn(app, w.users.studentA), assignmentId);
    const admin = await signedIn(app, w.users.adminA);
    expect((await admin.get(`${A}/submissions/${subA}`)).status).toBe(404);
    // Admins can see the assignment exists, so the inbox denial is an explicit 403.
    expect((await admin.get(`${A}/assignments/${assignmentId}/submissions`)).status).toBe(403);
    // The UI hides grading entry points from administrators based on this flag (it shows them to instructors).
    const asAdmin = await admin.get(`${A}/assignments/${assignmentId}`);
    expect(asAdmin.body).toMatchObject({ canManage: true, canGrade: false });
    const listed = await admin.get(`${A}/assignments`);
    expect(listed.body.items.find((x: { id: string }) => x.id === assignmentId)?.canGrade).toBe(false);
    const teacher = await signedIn(app, w.users.teacherA);
    expect((await teacher.get(`${A}/assignments/${assignmentId}`)).body).toMatchObject({ canGrade: true });
    expect((await admin.get(`${A}/admin/submissions/${subA}`)).status).toBe(400);
    const res = await admin.get(`${A}/admin/submissions/${subA}?reason=Grade%20appeal%20%2342`);
    expect(res.status).toBe(200);
    const log = await AuditLog.findOne({ action: 'admin.submission_accessed' });
    expect(log?.metadata).toMatchObject({ reason: 'Grade appeal #42' });
  });
});

describe('injection and data exposure', () => {
  it('rejects MongoDB operators in JSON bodies and query strings', async () => {
    const client = await new Client(app).init();
    const login = await client.post('/auth/login', { email: { $gt: '' }, password: { $gt: '' } });
    expect(login.status).toBe(400);
    const admin = await signedIn(app, w.users.adminA);
    const q = await admin.get(`${A}/members?role[$ne]=student&sort=password`);
    expect(q.status).toBe(400);
    const regex = await admin.get(`${A}/members?q=${encodeURIComponent('.*')}`);
    expect(regex.status).toBe(200);
    expect(regex.body.total).toBe(0); // treated as a literal string, not a pattern
    expect((await admin.get(`${A}/courses/not-an-id`)).status).toBe(400);
  });

  it('never returns password hashes, token hashes or private notes', async () => {
    const admin = await signedIn(app, w.users.adminA);
    const members = await admin.get(`${A}/members`);
    const me = await admin.get('/me');
    for (const body of [members.body, me.body]) {
      expect(JSON.stringify(body)).not.toMatch(/passwordHash|refreshTokenHash|tokenHash|\$argon2/);
    }
  });

  it('returns sanitized errors with a request id and no stack traces', async () => {
    const res = await new Client(app).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'not_found' });
    expect(res.body.error.requestId).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts:\d+/);
    const big = await (
      await new Client(app).init()
    ).post('/auth/login', { email: 'a@b.co', password: 'x'.repeat(2_000_000) });
    expect(big.status).toBe(413);
  });

  it('sets security headers and no-store caching on API responses', async () => {
    const res = await new Client(app).get('/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
    const cors = await new Client(app).agent.get(api('/health/live')).set('Origin', 'https://evil.example');
    expect(cors.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('platform administration', () => {
  it('is invisible to organization administrators', async () => {
    const admin = await signedIn(app, w.users.adminA);
    expect((await admin.get('/platform/orgs')).status).toBe(404);
    expect(
      (await admin.post('/platform/orgs', { name: 'x', slug: 'xyz', timezone: 'UTC', adminEmail: 'a@b.co' }))
        .status,
    ).toBe(404);
  });
});
