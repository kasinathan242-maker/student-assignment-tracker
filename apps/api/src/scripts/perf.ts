/* eslint-disable no-console */
/**
 * Performance measurement against a realistic dataset in an isolated in-memory replica set.
 *   npm run perf -w @sat/api
 * Dataset: 1 organization, 30 courses, 1,500 students (each in 4 courses), 240 published assignments,
 * ~45,000 submissions with versions and grades. Reports p50/p95/max latency per operation over N runs.
 * Results are recorded in docs/performance.md; the budgets there are checked by this script's exit code.
 */
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';

const RUNS = Number(process.env.PERF_RUNS ?? 30);
const PASSWORD = 'performance passphrase 2026';

/** Budgets (p95, milliseconds) — see docs/performance.md. */
const BUDGETS: Record<string, number> = {
  login: 250,
  'student dashboard': 300,
  'student assignment list': 300,
  'teacher dashboard': 400,
  'course roster (page 1)': 150,
  'submission inbox (filtered)': 400,
  'grading: save draft': 150,
  'assignment stats': 250,
  'course report': 800,
  'admin dashboard': 400,
  'submit (draft + final)': 300,
};

async function main() {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await replSet.waitUntilRunning();
  const uri = new URL(replSet.getUri());
  uri.pathname = '/sat_perf';
  Object.assign(process.env, {
    NODE_ENV: 'development',
    MONGO_URI: uri.toString(),
    EMAIL_PROVIDER: 'memory',
    RATE_LIMIT_ENABLED: 'false',
    RUN_WORKER_INLINE: 'false',
    LOG_LEVEL: 'silent',
    LOCAL_STORAGE_DIR: mkdtempSync(path.join(tmpdir(), 'sat-perf-')),
  });
  const { connectDatabase, disconnectDatabase } = await import('../db/connection');
  const { createApp } = await import('../app');
  const m = await import('../models');
  const { hashPassword } = await import('../services/passwords');
  await connectDatabase();

  console.log('Seeding dataset…');
  const t0 = Date.now();
  const passwordHash = await hashPassword(PASSWORD);
  const org = await m.Organization.create({
    name: 'Perf University',
    slug: 'perf',
    timezone: 'Asia/Kolkata',
    settings: m.defaultOrgSettings(),
  });
  const mkUsers = (n: number, prefix: string) =>
    Array.from({ length: n }, (_, i) => ({
      _id: new Types.ObjectId(),
      email: `${prefix}${i}@perf.test`,
      name: `${prefix} ${i}`,
      passwordHash,
      emailVerifiedAt: new Date(),
      notificationPreferences: m.defaultNotificationPreferences(),
    }));
  const students = mkUsers(1500, 'student');
  const teachers = mkUsers(30, 'teacher');
  const admin = mkUsers(1, 'admin');
  await m.User.insertMany([...students, ...teachers, ...admin]);
  const now = new Date();
  await m.Membership.insertMany([
    ...students.map((u, i) => ({
      orgId: org._id,
      userId: u._id,
      role: 'student',
      status: 'active',
      joinedAt: now,
      studentNumber: `P${i}`,
    })),
    ...teachers.map((u) => ({
      orgId: org._id,
      userId: u._id,
      role: 'teacher',
      status: 'active',
      joinedAt: now,
    })),
    { orgId: org._id, userId: admin[0]?._id, role: 'org_admin', status: 'active', joinedAt: now },
  ]);
  const courses = await m.Course.insertMany(
    Array.from({ length: 30 }, (_, i) => ({
      orgId: org._id,
      code: `C${100 + i}`,
      title: `Course ${i}`,
      term: '2026',
    })),
  );
  const enrollments: object[] = [];
  courses.forEach((c, i) =>
    enrollments.push({
      orgId: org._id,
      courseId: c._id,
      userId: teachers[i]?._id,
      role: 'instructor',
      status: 'active',
      enrolledAt: now,
    }),
  );
  students.forEach((s, i) => {
    for (let k = 0; k < 4; k += 1)
      enrollments.push({
        orgId: org._id,
        courseId: courses[(i + k * 7) % 30]?._id,
        userId: s._id,
        role: 'student',
        status: 'active',
        enrolledAt: now,
      });
  });
  await m.Enrollment.insertMany(enrollments, { ordered: false }).catch(() => undefined);
  const assignments = await m.Assignment.insertMany(
    courses.flatMap((c, ci) =>
      Array.from({ length: 8 }, (_, k) => ({
        orgId: org._id,
        courseId: c._id,
        createdBy: teachers[ci]?._id,
        title: `Assignment ${k} for ${c.code}`,
        type: 'homework',
        maxPoints: 20,
        status: 'published',
        publishedAt: new Date(now.getTime() - 20 * 86_400_000),
        dueAt: new Date(now.getTime() + (k - 4) * 86_400_000),
        timezone: 'Asia/Kolkata',
        latePolicy: { mode: 'accept', penaltyPercentPerDay: 0, maxLateDays: null },
        submissionMethods: { text: true, file: false, url: false },
        fileRules: { allowedExtensions: ['pdf'], maxFiles: 1, maxFileSizeMb: 5 },
      })),
    ),
  );
  const byCourse = new Map<string, Types.ObjectId[]>();
  for (const e of enrollments as { courseId: Types.ObjectId; userId: Types.ObjectId; role: string }[]) {
    if (e.role !== 'student') continue;
    byCourse.set(String(e.courseId), [...(byCourse.get(String(e.courseId)) ?? []), e.userId]);
  }
  let subCount = 0;
  for (const a of assignments) {
    if (a.dueAt > now) continue; // past-due assignments are mostly submitted
    const subs: object[] = [];
    const versions: object[] = [];
    const grades: object[] = [];
    for (const studentId of byCourse.get(String(a.courseId)) ?? []) {
      if (Math.random() < 0.1) continue;
      const subId = new Types.ObjectId();
      const verId = new Types.ObjectId();
      const at = new Date(a.dueAt.getTime() - 3_600_000);
      subs.push({
        _id: subId,
        orgId: org._id,
        courseId: a.courseId,
        assignmentId: a._id,
        studentId,
        state: 'graded',
        draft: { text: 'x', url: null, fileIds: [] },
        attemptCount: 1,
        currentVersionId: verId,
        lastSubmittedAt: at,
        isLate: false,
      });
      versions.push({
        _id: verId,
        orgId: org._id,
        submissionId: subId,
        assignmentId: a._id,
        studentId,
        attemptNumber: 1,
        text: 'Answer text',
        files: [],
        submittedAt: at,
        isLate: false,
        effectiveDueAt: a.dueAt,
        receiptCode: `SAT-${subId.toHexString()}`,
      });
      const content = {
        rawPoints: 15,
        latePenaltyPoints: 0,
        finalPoints: 15,
        maxPoints: 20,
        feedback: 'ok',
        privateNotes: '',
        rubricScores: [],
        rubric: null,
        versionId: verId,
        gradedBy: a.createdBy,
        gradedAt: now,
      };
      grades.push({
        orgId: org._id,
        courseId: a.courseId,
        assignmentId: a._id,
        submissionId: subId,
        studentId,
        published: content,
        publishedAt: now,
      });
    }
    await Promise.all([
      m.Submission.insertMany(subs),
      m.SubmissionVersion.insertMany(versions),
      m.Grade.insertMany(grades),
    ]);
    subCount += subs.length;
  }
  console.log(
    `Seeded ${students.length} students, ${courses.length} courses, ${assignments.length} assignments, ${subCount} submissions in ${((Date.now() - t0) / 1000).toFixed(1)}s.\n`,
  );

  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const jar = new Map<string, string>();
  const client =
    (store: Map<string, string>) =>
    async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
      const cookie = [...store.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
      const res = await fetch(`${base}${url}`, {
        method,
        headers: {
          'content-type': 'application/json',
          cookie,
          'x-csrf-token': store.get('sat_csrf') ?? '',
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';');
        const [k, v] = (pair ?? '').split('=');
        if (k) store.set(k, v ?? '');
      }
      if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${await res.text()}`);
      return res.json().catch(() => null) as Promise<unknown>;
    };
  const session = async (email: string) => {
    const store = new Map<string, string>();
    const call = client(store);
    await call('GET', '/auth/csrf');
    await call('POST', '/auth/login', { email, password: PASSWORD });
    return call;
  };
  await client(jar)('GET', '/auth/csrf');

  const results: { name: string; p50: number; p95: number; max: number }[] = [];
  const measure = async (name: string, fn: () => Promise<unknown>) => {
    await fn(); // warm-up
    const times: number[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      const t = performance.now();
      await fn();
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const pct = (p: number) => times[Math.min(times.length - 1, Math.floor((p / 100) * times.length))] ?? 0;
    results.push({ name, p50: pct(50), p95: pct(95), max: times.at(-1) ?? 0 });
  };

  const orgPath = `/orgs/${org._id.toString()}`;
  const student = await session('student7@perf.test');
  const teacher = await session('teacher3@perf.test');
  const adminCall = await session('admin0@perf.test');
  const course = courses[3];
  const past = assignments.find((a) => String(a.courseId) === String(course?._id) && a.dueAt < now);
  const future = assignments.filter((a) => a.dueAt > now);
  const inbox = (await teacher(
    'GET',
    `${orgPath}/assignments/${past?._id.toString()}/submissions?pageSize=50`,
  )) as { items: { submissionId: string | null }[] };
  const subId = inbox.items.find((r) => r.submissionId)?.submissionId;

  await measure('login', () =>
    client(new Map(jar))('POST', '/auth/login', { email: 'student9@perf.test', password: PASSWORD }),
  );
  await measure('student dashboard', () => student('GET', `${orgPath}/dashboard/student`));
  await measure('student assignment list', () => student('GET', `${orgPath}/assignments?pageSize=25`));
  await measure('teacher dashboard', () => teacher('GET', `${orgPath}/dashboard/teacher`));
  await measure('course roster (page 1)', () =>
    teacher('GET', `${orgPath}/courses/${course?._id.toString()}/roster?pageSize=25`),
  );
  await measure('submission inbox (filtered)', () =>
    teacher('GET', `${orgPath}/assignments/${past?._id.toString()}/submissions?status=late&pageSize=50`),
  );
  await measure('grading: save draft', () =>
    teacher('PUT', `${orgPath}/submissions/${subId}/grade`, { points: 17, feedback: 'Good' }).catch(() =>
      teacher('PUT', `${orgPath}/submissions/${subId}/grade`, { points: 17, feedback: 'Good' }),
    ),
  );
  await measure('assignment stats', () =>
    teacher('GET', `${orgPath}/assignments/${past?._id.toString()}/stats`),
  );
  await measure('course report', () => teacher('GET', `${orgPath}/courses/${course?._id.toString()}/report`));
  await measure('admin dashboard', () => adminCall('GET', `${orgPath}/dashboard/admin`));
  // Submission: one distinct student per run (sessions created outside the timed section).
  const target = future.find((a) => String(a.courseId) === String(course?._id));
  const submitters = (byCourse.get(String(course?._id)) ?? []).slice(0, RUNS + 1);
  const sessions: Awaited<ReturnType<typeof session>>[] = [];
  for (const id of submitters)
    sessions.push(await session(students.find((u) => u._id.equals(id))?.email ?? ''));
  let next = 0;
  await measure('submit (draft + final)', async () => {
    const call = sessions[next++];
    if (!call) throw new Error('not enough student sessions');
    const draft = (await call('PUT', `${orgPath}/assignments/${target?._id.toString()}/my-submission/draft`, {
      text: 'Perf answer',
    })) as { rev: number };
    return call('POST', `${orgPath}/assignments/${target?._id.toString()}/my-submission/submit`, {
      expectedRev: draft.rev,
    });
  });

  console.log('Operation                        p50 ms   p95 ms   max ms   budget p95');
  let failed = false;
  for (const r of results) {
    const budget = BUDGETS[r.name] ?? Infinity;
    const ok = r.p95 <= budget;
    failed ||= !ok;
    console.log(
      `${r.name.padEnd(32)} ${r.p50.toFixed(1).padStart(6)}   ${r.p95.toFixed(1).padStart(6)}   ${r.max.toFixed(1).padStart(6)}   ${String(budget).padStart(6)} ${ok ? 'ok' : 'OVER'}`,
    );
  }
  server.close();
  await disconnectDatabase();
  await replSet.stop();
  process.exit(failed ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
