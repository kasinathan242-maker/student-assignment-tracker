/* eslint-disable no-console */
import { randomBytes } from 'node:crypto';
import { computeFinalScore, passwordIssues } from '@sat/shared';
import { env } from '../config/env';
import { connectDatabase, disconnectDatabase } from '../db/connection';
import { receiptCode } from '../lib/crypto';
import {
  Announcement,
  Assignment,
  Course,
  Department,
  Enrollment,
  ExtensionRequest,
  Grade,
  Membership,
  Organization,
  Rubric,
  Section,
  Submission,
  SubmissionVersion,
  User,
  defaultNotificationPreferences,
  defaultOrgSettings,
  type AssignmentDoc,
  type Id,
  type OrganizationDoc,
  type UserDoc,
} from '../models';
import { hashPassword } from '../services/passwords';

/**
 * Development/demo data. Refuses to run in production. Accounts use SEED_PASSWORD when set (it must meet
 * the password policy); otherwise a random password is generated and printed once. Re-running with
 * --reset removes the demo organizations first.
 */
const DAY = 86_400_000;
const now = Date.now();
const at = (days: number, hour = 17) => {
  const d = new Date(now + days * DAY);
  d.setUTCHours(hour - 5, 30, 0, 0);
  return d;
};

async function main() {
  const config = env();
  if (config.isProduction) throw new Error('Refusing to seed demo data in production.');
  const password = process.env.SEED_PASSWORD ?? `demo-${randomBytes(9).toString('base64url')}`;
  const issues = passwordIssues(password);
  if (issues.length) throw new Error(`SEED_PASSWORD rejected: ${issues.join(' ')}`);
  await connectDatabase();

  const slugs = ['northfield', 'riverside'];
  const existing = await Organization.find({ slug: { $in: slugs } }).lean<OrganizationDoc[]>();
  if (existing.length) {
    if (!process.argv.includes('--reset')) {
      console.log('Demo organizations already exist. Run `npm run seed -- --reset` to recreate them.');
      await disconnectDatabase();
      return;
    }
    const ids = existing.map((o) => o._id);
    const userIds = await Membership.find({ orgId: { $in: ids } }).distinct('userId');
    await Promise.all(
      [
        Announcement,
        Assignment,
        Course,
        Department,
        Enrollment,
        ExtensionRequest,
        Grade,
        Membership,
        Rubric,
        Section,
        Submission,
        SubmissionVersion,
      ].map((m) =>
        (m as unknown as { deleteMany: (f: object) => Promise<unknown> }).deleteMany({ orgId: { $in: ids } }),
      ),
    );
    await Organization.deleteMany({ _id: { $in: ids } });
    await User.deleteMany({ _id: { $in: userIds }, email: /@(northfield|riverside)\.test$/ });
    await User.deleteMany({ email: 'platform@demo.test' });
  }

  const passwordHash = await hashPassword(password);
  const mkUser = async (name: string, email: string, extra: Partial<UserDoc> = {}) =>
    (
      await User.create({
        name,
        email,
        passwordHash,
        emailVerifiedAt: new Date(),
        timezone: 'Asia/Kolkata',
        notificationPreferences: defaultNotificationPreferences(),
        ...extra,
      })
    ).toObject() as UserDoc;

  await mkUser('Platform Operations', 'platform@demo.test', {
    platformRole: 'platform_admin',
    timezone: 'UTC',
  });

  const org = (
    await Organization.create({
      name: 'Northfield University',
      slug: 'northfield',
      timezone: 'Asia/Kolkata',
      settings: { ...defaultOrgSettings(), selfRegistration: 'approval' },
      joinCode: 'NORTH2026',
    })
  ).toObject() as OrganizationDoc;
  const other = (
    await Organization.create({
      name: 'Riverside College',
      slug: 'riverside',
      timezone: 'Europe/London',
      settings: defaultOrgSettings(),
    })
  ).toObject() as OrganizationDoc;

  const admin = await mkUser('Dr. Meera Iyer', 'admin@northfield.test');
  const priya = await mkUser('Prof. Priya Raman', 'priya@northfield.test');
  const arjun = await mkUser('Dr. Arjun Mehta', 'arjun@northfield.test');
  const studentNames = [
    'Kavya Nair',
    'Rahul Verma',
    'Ananya Das',
    'Vikram Singh',
    'Sneha Pillai',
    'Farhan Ali',
  ];
  const students: UserDoc[] = [];
  for (const name of studentNames)
    students.push(await mkUser(name, `${name.split(' ')[0]?.toLowerCase()}@northfield.test`));
  const riversideAdmin = await mkUser('Tom Hughes', 'admin@riverside.test', { timezone: 'Europe/London' });
  const riversideStudent = await mkUser('Ella Brooks', 'ella@riverside.test', { timezone: 'Europe/London' });

  const member = (
    o: OrganizationDoc,
    u: UserDoc,
    role: 'student' | 'teacher' | 'org_admin',
    studentNumber: string | null = null,
  ) =>
    Membership.create({
      orgId: o._id,
      userId: u._id,
      role,
      status: 'active',
      joinedAt: new Date(now - 60 * DAY),
      studentNumber,
    });
  await member(org, admin, 'org_admin');
  await member(org, priya, 'teacher');
  await member(org, arjun, 'teacher');
  for (const [i, s] of students.entries())
    await member(org, s, 'student', `NU2026-${String(i + 1).padStart(3, '0')}`);
  await member(other, riversideAdmin, 'org_admin');
  await member(other, riversideStudent, 'student', 'RC-001');

  const cs = await Department.create({ orgId: org._id, name: 'Computer Science', code: 'CS' });
  const math = await Department.create({ orgId: org._id, name: 'Mathematics', code: 'MATH' });
  const cs101 = await Course.create({
    orgId: org._id,
    departmentId: cs._id,
    code: 'CS101',
    title: 'Introduction to Programming',
    term: '2026 Monsoon',
    description: 'Problem solving with Python: control flow, data structures and testing.',
    createdBy: priya._id,
  });
  const math201 = await Course.create({
    orgId: org._id,
    departmentId: math._id,
    code: 'MATH201',
    title: 'Linear Algebra',
    term: '2026 Monsoon',
    description: 'Vector spaces, linear maps, eigenvalues and applications.',
    createdBy: arjun._id,
  });
  const secA = await Section.create({ orgId: org._id, courseId: cs101._id, name: 'Section A' });
  const secB = await Section.create({ orgId: org._id, courseId: cs101._id, name: 'Section B' });

  const enroll = (courseId: Id, userId: Id, role: 'instructor' | 'student', sectionId: Id | null = null) =>
    Enrollment.create({
      orgId: org._id,
      courseId,
      userId,
      role,
      status: 'active',
      enrolledAt: new Date(now - 50 * DAY),
      sectionId,
    });
  await enroll(cs101._id, priya._id, 'instructor');
  await enroll(math201._id, arjun._id, 'instructor');
  for (const [i, s] of students.entries()) {
    await enroll(cs101._id, s._id, 'student', i % 2 === 0 ? secA._id : secB._id);
    if (i < 4) await enroll(math201._id, s._id, 'student');
  }

  const rubric = await Rubric.create({
    orgId: org._id,
    ownerId: priya._id,
    courseId: cs101._id,
    title: 'Programming assignment rubric',
    description: 'Used for CS101 lab work.',
    criteria: [
      {
        id: 'correct',
        title: 'Correctness',
        description: 'Passes the provided and hidden tests.',
        maxPoints: 10,
        levels: [
          { title: 'All tests pass', points: 10 },
          { title: 'Most tests pass', points: 7 },
          { title: 'Some tests pass', points: 4 },
        ],
      },
      {
        id: 'design',
        title: 'Design & readability',
        description: 'Clear structure, naming and comments.',
        maxPoints: 10,
        levels: [],
      },
      { id: 'tests', title: 'Own tests', description: 'Meaningful unit tests.', maxPoints: 5, levels: [] },
    ],
  });

  const base = {
    orgId: org._id,
    timezone: 'Asia/Kolkata',
    gracePeriodMinutes: 10,
    resubmission: { allowed: false, maxAttempts: null },
    submissionMethods: { text: true, file: true, url: false },
    fileRules: { allowedExtensions: ['pdf', 'py', 'zip', 'txt'], maxFiles: 3, maxFileSizeMb: 10 },
    extensionsAllowed: true,
    gradeRelease: 'immediate' as const,
  };
  const mkAssignment = async (
    fields: Partial<AssignmentDoc> &
      Pick<AssignmentDoc, 'title' | 'courseId' | 'createdBy' | 'dueAt' | 'type' | 'maxPoints' | 'status'>,
  ) =>
    (
      await Assignment.create({
        ...base,
        latePolicy: { mode: 'penalize', penaltyPercentPerDay: 10, maxLateDays: 3 },
        ...fields,
      })
    ).toObject() as AssignmentDoc;

  const lab1 = await mkAssignment({
    title: 'Lab 1 — Variables and control flow',
    courseId: cs101._id,
    createdBy: priya._id,
    type: 'lab',
    maxPoints: 25,
    rubricId: rubric._id,
    status: 'closed',
    publishedAt: at(-30),
    dueAt: at(-16),
    closedAt: at(-12),
    description: 'Warm-up exercises on conditionals and loops.',
    instructions: 'Solve the five exercises in `lab1.py`. Submit your file and a short reflection.',
    learningObjectives: ['Use if/elif/else correctly', 'Write for and while loops'],
  });
  const lab2 = await mkAssignment({
    title: 'Lab 2 — Lists and dictionaries',
    courseId: cs101._id,
    createdBy: priya._id,
    type: 'lab',
    maxPoints: 25,
    rubricId: rubric._id,
    status: 'published',
    publishedAt: at(-10),
    dueAt: at(2),
    instructions:
      'Implement the inventory functions described in the handout. Include at least three unit tests.',
    learningObjectives: ['Model data with lists and dictionaries', 'Write unit tests'],
  });
  const essay = await mkAssignment({
    title: 'Reflection essay: debugging strategies',
    courseId: cs101._id,
    createdBy: priya._id,
    type: 'essay',
    maxPoints: 10,
    status: 'published',
    publishedAt: at(-5),
    dueAt: at(0.6),
    submissionMethods: { text: true, file: false, url: false },
    latePolicy: { mode: 'reject', penaltyPercentPerDay: 0, maxLateDays: null },
    resubmission: { allowed: true, maxAttempts: 2 },
    instructions: 'In 400–600 words, describe a bug you fixed this term and how you found it.',
  });
  await mkAssignment({
    title: 'Project proposal',
    courseId: cs101._id,
    createdBy: priya._id,
    type: 'project',
    maxPoints: 20,
    status: 'scheduled',
    publishAt: at(3, 9),
    dueAt: at(14),
    sectionIds: [secA._id],
    instructions: 'One-page proposal for your final project.',
  });
  await mkAssignment({
    title: 'Lab 3 — Functions and recursion (draft)',
    courseId: cs101._id,
    createdBy: priya._id,
    type: 'lab',
    maxPoints: 25,
    status: 'draft',
    dueAt: at(21),
  });
  const ps1 = await mkAssignment({
    title: 'Problem set 1 — Vector spaces',
    courseId: math201._id,
    createdBy: arjun._id,
    type: 'homework',
    maxPoints: 50,
    status: 'published',
    publishedAt: at(-12),
    dueAt: at(-2),
    submissionMethods: { text: false, file: true, url: false },
    fileRules: { allowedExtensions: ['pdf'], maxFiles: 1, maxFileSizeMb: 20 },
    gradeRelease: 'hold',
    instructions: 'Handwritten or typeset solutions as a single PDF.',
  });
  await mkAssignment({
    title: 'Problem set 2 — Linear maps',
    courseId: math201._id,
    createdBy: arjun._id,
    type: 'homework',
    maxPoints: 50,
    status: 'published',
    publishedAt: at(-1),
    dueAt: at(6),
    submissionMethods: { text: false, file: false, url: true },
    instructions: 'Share a link to your Overleaf/Google Docs write-up with view access.',
  });

  const submit = async (
    a: AssignmentDoc,
    s: UserDoc,
    opts: {
      daysBeforeDue: number;
      text?: string;
      grade?: { raw: number; feedback: string; publish: boolean; rubric?: boolean };
      state?: 'submitted' | 'returned';
    },
  ) => {
    const submittedAt = new Date(a.dueAt.getTime() - opts.daysBeforeDue * DAY);
    const lateBy = Math.max(0, Math.ceil((submittedAt.getTime() - a.dueAt.getTime()) / 60_000));
    const isLate = submittedAt.getTime() > a.dueAt.getTime() + a.gracePeriodMinutes * 60_000;
    const sub = await Submission.create({
      orgId: org._id,
      courseId: a.courseId,
      assignmentId: a._id,
      studentId: s._id,
      state: opts.state ?? 'submitted',
      draft: { text: opts.text ?? null, url: null, fileIds: [], savedAt: submittedAt },
      attemptCount: 1,
      lastSubmittedAt: submittedAt,
      isLate,
      returnFeedback: opts.state === 'returned' ? 'Please add test cases for empty input.' : null,
      returnedAt: opts.state === 'returned' ? new Date() : null,
    });
    const version = await SubmissionVersion.create({
      orgId: org._id,
      submissionId: sub._id,
      assignmentId: a._id,
      studentId: s._id,
      attemptNumber: 1,
      text: opts.text ?? null,
      url: null,
      files: [],
      submittedAt,
      isLate,
      lateByMinutes: isLate ? lateBy : 0,
      effectiveDueAt: a.dueAt,
      receiptCode: receiptCode(),
    });
    await Submission.updateOne({ _id: sub._id }, { $set: { currentVersionId: version._id } });
    if (opts.grade) {
      const score = computeFinalScore(opts.grade.raw, a.maxPoints, isLate ? lateBy : 0, a.latePolicy);
      const content = {
        rawPoints: score.rawPoints,
        latePenaltyPoints: score.latePenaltyPoints,
        finalPoints: score.finalPoints,
        maxPoints: a.maxPoints,
        feedback: opts.grade.feedback,
        privateNotes: '',
        rubricScores: opts.grade.rubric
          ? [
              { criterionId: 'correct', points: Math.min(10, Math.round(opts.grade.raw * 0.4)), comment: '' },
              { criterionId: 'design', points: Math.min(10, Math.round(opts.grade.raw * 0.4)), comment: '' },
              {
                criterionId: 'tests',
                points: opts.grade.raw - 2 * Math.min(10, Math.round(opts.grade.raw * 0.4)),
                comment: '',
              },
            ]
          : [],
        rubric: opts.grade.rubric ? rubric.toObject().criteria : null,
        versionId: version._id,
        gradedBy: a.createdBy,
        gradedAt: new Date(),
      };
      await Grade.create({
        orgId: org._id,
        courseId: a.courseId,
        assignmentId: a._id,
        submissionId: sub._id,
        studentId: s._id,
        ...(opts.grade.publish
          ? { published: content, publishedAt: new Date(), publishedBy: a.createdBy }
          : { draft: content }),
      });
      if (opts.grade.publish) await Submission.updateOne({ _id: sub._id }, { $set: { state: 'graded' } });
    }
  };

  const [kavya, rahul, ananya, vikram, sneha] = students as [
    UserDoc,
    UserDoc,
    UserDoc,
    UserDoc,
    UserDoc,
    UserDoc,
  ];
  await submit(lab1, kavya, {
    daysBeforeDue: 1,
    text: 'Solutions attached in lab1.py.',
    grade: {
      raw: 23,
      feedback: 'Excellent structure. Watch off-by-one errors in exercise 4.',
      publish: true,
      rubric: true,
    },
  });
  await submit(lab1, rahul, {
    daysBeforeDue: -0.5,
    text: 'Submitted late, sorry — network outage.',
    grade: { raw: 20, feedback: 'Correct, but late. Good tests.', publish: true, rubric: true },
  });
  await submit(lab1, ananya, {
    daysBeforeDue: 2,
    text: 'All five exercises done.',
    grade: { raw: 18, feedback: 'Exercise 5 misses the empty-list case.', publish: true, rubric: true },
  });
  await submit(lab1, vikram, { daysBeforeDue: 0.2, text: 'Done.', state: 'returned' });
  await submit(lab2, kavya, { daysBeforeDue: 1, text: 'Inventory functions with 5 tests.' });
  await submit(lab2, sneha, {
    daysBeforeDue: 1.5,
    text: 'First version.',
    grade: { raw: 21, feedback: 'Draft feedback — not yet released.', publish: false, rubric: true },
  });
  await submit(ps1, kavya, {
    daysBeforeDue: 1,
    grade: { raw: 44, feedback: 'Clear proofs.', publish: true },
  });
  await submit(ps1, rahul, {
    daysBeforeDue: 0.1,
    grade: { raw: 38, feedback: 'Check the dimension argument in Q3.', publish: true },
  });

  await ExtensionRequest.create({
    orgId: org._id,
    courseId: cs101._id,
    assignmentId: essay._id,
    studentId: rahul._id,
    reason: 'Representing the university at the inter-college hackathon this week.',
    requestedDueAt: at(4),
    originalDueAt: essay.dueAt,
    status: 'pending',
  });

  await Announcement.create({
    orgId: org._id,
    courseId: cs101._id,
    authorId: priya._id,
    title: 'Lab 2 office hours moved',
    body: 'Office hours this week are on **Thursday 3–5 pm** in Lab 204.\n\nBring your failing test cases.',
    audience: 'course',
    status: 'published',
    publishedAt: new Date(now - 2 * DAY),
  });
  await Announcement.create({
    orgId: org._id,
    courseId: null,
    authorId: admin._id,
    title: 'Mid-term examination schedule published',
    body: 'The mid-term timetable is available on the notice board. Exams begin on the 20th.',
    audience: 'org_all',
    status: 'published',
    publishedAt: new Date(now - DAY),
    requireAck: true,
  });

  await disconnectDatabase();
  console.log('\nDemo data created.\n');
  console.log(
    `Password for every demo account: ${password}${process.env.SEED_PASSWORD ? ' (from SEED_PASSWORD)' : ' (randomly generated — shown once)'}\n`,
  );
  console.log('  platform@demo.test         platform administrator');
  console.log('  admin@northfield.test      organization administrator (Northfield University)');
  console.log('  priya@northfield.test      teacher — CS101');
  console.log('  arjun@northfield.test      teacher — MATH201');
  console.log('  kavya@northfield.test      student (also rahul, ananya, vikram, sneha, farhan)');
  console.log('  admin@riverside.test       administrator of a second organization (tenant isolation)\n');
}

main().catch(async (err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
