import type { Express } from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import type { CreateAssignmentInput } from '@sat/shared';
import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import { registerHandlers } from '../src/jobs/handlers';
import {
  Course,
  Enrollment,
  Membership,
  Organization,
  User,
  defaultNotificationPreferences,
  defaultOrgSettings,
  type CourseDoc,
  type OrganizationDoc,
  type UserDoc,
} from '../src/models';
import { emailProvider, MemoryProvider } from '../src/services/email/provider';
import { drainOutbox } from '../src/services/outbox';
import { hashPassword } from '../src/services/passwords';

export const PASSWORD = 'correct horse battery staple';

export async function startTestApp(): Promise<Express> {
  await connectDatabase();
  registerHandlers();
  return createApp();
}

export async function stopTestApp(): Promise<void> {
  await mongoose.connection.dropDatabase().catch(() => undefined);
  await disconnectDatabase();
}

export const api = (path: string) => `/api/v1${path}`;

/** Cookie-carrying HTTP client that handles CSRF like the web app does. */
export class Client {
  readonly agent: TestAgent;
  csrf = '';
  constructor(app: Express) {
    this.agent = request.agent(app);
  }
  async init(): Promise<this> {
    const res = await this.agent.get(api('/auth/csrf'));
    this.csrf = res.body.csrfToken;
    return this;
  }
  get(path: string) {
    return this.agent.get(api(path));
  }
  post(path: string, body?: object) {
    return this.agent
      .post(api(path))
      .set('x-csrf-token', this.csrf)
      .send(body ?? {});
  }
  put(path: string, body?: object) {
    return this.agent
      .put(api(path))
      .set('x-csrf-token', this.csrf)
      .send(body ?? {});
  }
  patch(path: string, body?: object) {
    return this.agent
      .patch(api(path))
      .set('x-csrf-token', this.csrf)
      .send(body ?? {});
  }
  delete(path: string, body?: object) {
    return this.agent
      .delete(api(path))
      .set('x-csrf-token', this.csrf)
      .send(body ?? {});
  }
  upload(path: string, filename: string, content: Buffer) {
    return this.agent.post(api(path)).set('x-csrf-token', this.csrf).attach('file', content, filename);
  }
  async login(email: string, password = PASSWORD) {
    const res = await this.post('/auth/login', { email, password });
    if (res.status === 200) this.csrf = res.body.csrfToken;
    return res;
  }
}

let seq = 0;
const unique = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq += 1)}`;

export async function createUser(
  opts: Partial<Pick<UserDoc, 'email' | 'name' | 'platformRole' | 'status'>> & {
    verified?: boolean;
    password?: string;
  } = {},
): Promise<UserDoc> {
  const user = await User.create({
    email: opts.email ?? `${unique('user')}@example.edu`,
    name: opts.name ?? unique('User '),
    passwordHash: await hashPassword(opts.password ?? PASSWORD),
    emailVerifiedAt: opts.verified === false ? null : new Date(),
    platformRole: opts.platformRole ?? null,
    status: opts.status ?? 'active',
    notificationPreferences: defaultNotificationPreferences(),
  });
  return user.toObject() as UserDoc;
}

export async function createOrg(name = unique('Org ')): Promise<OrganizationDoc> {
  const org = await Organization.create({
    name,
    slug: unique('org-').toLowerCase(),
    timezone: 'Asia/Kolkata',
    settings: defaultOrgSettings(),
  });
  return org.toObject() as OrganizationDoc;
}

export async function addMember(
  org: OrganizationDoc,
  user: UserDoc,
  role: 'student' | 'teacher' | 'org_admin',
) {
  await Membership.create({ orgId: org._id, userId: user._id, role, status: 'active', joinedAt: new Date() });
}

export async function createCourse(
  org: OrganizationDoc,
  code = unique('CS').toUpperCase(),
): Promise<CourseDoc> {
  return (
    await Course.create({ orgId: org._id, code, title: `${code} Course`, term: '2026-T1' })
  ).toObject() as CourseDoc;
}

export async function enroll(
  course: CourseDoc,
  user: UserDoc,
  role: 'instructor' | 'student',
  sectionId: mongoose.Types.ObjectId | null = null,
) {
  await Enrollment.create({
    orgId: course.orgId,
    courseId: course._id,
    userId: user._id,
    role,
    status: 'active',
    enrolledAt: new Date(),
    sectionId,
  });
}

export async function signedIn(app: Express, user: UserDoc): Promise<Client> {
  const client = await new Client(app).init();
  const res = await client.login(user.email);
  if (res.status !== 200)
    throw new Error(`login failed for ${user.email}: ${res.status} ${JSON.stringify(res.body)}`);
  return client;
}

export function assignmentInput(overrides: Partial<CreateAssignmentInput> = {}): CreateAssignmentInput {
  return {
    title: 'Essay on distributed systems',
    type: 'essay',
    maxPoints: 25,
    dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    timezone: 'Asia/Kolkata',
    latePolicy: { mode: 'reject', penaltyPercentPerDay: 0, maxLateDays: null },
    resubmission: { allowed: false, maxAttempts: null },
    submissionMethods: { text: true, file: true, url: false },
    fileRules: { allowedExtensions: ['pdf', 'txt'], maxFiles: 2, maxFileSizeMb: 5 },
    ...overrides,
  };
}

export interface World {
  orgA: OrganizationDoc;
  orgB: OrganizationDoc;
  course: CourseDoc;
  otherCourse: CourseDoc;
  users: Record<
    'adminA' | 'teacherA' | 'teacherA2' | 'studentA' | 'studentB' | 'adminB' | 'teacherB' | 'studentOrgB',
    UserDoc
  >;
}

/**
 * Standard fixture: organization A (admin, two teachers, two students; teacherA teaches `course`, teacherA2
 * teaches `otherCourse`) and organization B (admin, teacher, student) for cross-tenant checks.
 */
export async function buildWorld(): Promise<World> {
  const [orgA, orgB] = [await createOrg('Org A'), await createOrg('Org B')];
  const users = {
    adminA: await createUser({ name: 'Admin A' }),
    teacherA: await createUser({ name: 'Teacher A' }),
    teacherA2: await createUser({ name: 'Teacher A2' }),
    studentA: await createUser({ name: 'Student A' }),
    studentB: await createUser({ name: 'Student B' }),
    adminB: await createUser({ name: 'Admin B' }),
    teacherB: await createUser({ name: 'Teacher B' }),
    studentOrgB: await createUser({ name: 'Student OrgB' }),
  };
  await addMember(orgA, users.adminA, 'org_admin');
  await addMember(orgA, users.teacherA, 'teacher');
  await addMember(orgA, users.teacherA2, 'teacher');
  await addMember(orgA, users.studentA, 'student');
  await addMember(orgA, users.studentB, 'student');
  await addMember(orgB, users.adminB, 'org_admin');
  await addMember(orgB, users.teacherB, 'teacher');
  await addMember(orgB, users.studentOrgB, 'student');
  const course = await createCourse(orgA);
  const otherCourse = await createCourse(orgA);
  await enroll(course, users.teacherA, 'instructor');
  await enroll(course, users.studentA, 'student');
  await enroll(course, users.studentB, 'student');
  await enroll(otherCourse, users.teacherA2, 'instructor');
  return { orgA, orgB, course, otherCourse, users };
}

export function mailbox(): MemoryProvider {
  const provider = emailProvider();
  if (!(provider instanceof MemoryProvider)) throw new Error('memory email provider expected in tests');
  return provider;
}

/** Runs the outbox to completion (what the worker does) so notifications and emails materialise. */
export async function flushOutbox(): Promise<void> {
  while ((await drainOutbox(100)) > 0) {
    /* keep draining */
  }
}

export function tokenFromEmail(to: string, path: string): string {
  const message = mailbox().sent.find((m) => m.to === to && m.text.includes(path));
  if (!message) throw new Error(`no email to ${to} containing ${path}`);
  const match = message.text.match(/#token=([A-Za-z0-9_%-]+)/);
  if (!match?.[1]) throw new Error('no token in email');
  return decodeURIComponent(match[1]);
}

/** Minimal valid PDF bytes (passes magic-byte detection). */
export const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
