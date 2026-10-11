import { describe, expect, it } from 'vitest';
import { createAssignmentSchema, updateAssignmentSchema } from './assignment';
import { registerSchema } from './auth';
import { sortSchema } from './common';
import { addEnrollmentSchema } from './course';
import { orgSettingsSchema } from './org';
import { createAnnouncementSchema } from './submission';

const validAssignment = {
  title: 'Essay 1',
  type: 'essay',
  maxPoints: 25,
  dueAt: '2026-11-01T17:00:00Z',
  timezone: 'Asia/Kolkata',
  latePolicy: { mode: 'reject', penaltyPercentPerDay: 0, maxLateDays: null },
  resubmission: { allowed: false, maxAttempts: null },
  submissionMethods: { text: true, file: false, url: false },
  fileRules: { allowedExtensions: ['pdf'], maxFiles: 1, maxFileSizeMb: 10 },
};

describe('assignment schemas', () => {
  it('applies defaults on create', () => {
    const parsed = createAssignmentSchema.parse(validAssignment);
    expect(parsed).toMatchObject({
      description: '',
      gracePeriodMinutes: 0,
      sectionIds: [],
      gradeRelease: 'immediate',
    });
  });
  it('rejects inconsistent dates, unknown fields and bad time zones', () => {
    expect(
      createAssignmentSchema.safeParse({ ...validAssignment, availableFrom: '2026-12-01T00:00:00Z' }).success,
    ).toBe(false);
    expect(
      createAssignmentSchema.safeParse({ ...validAssignment, availableUntil: '2026-10-01T00:00:00Z' })
        .success,
    ).toBe(false);
    expect(createAssignmentSchema.safeParse({ ...validAssignment, organizationId: 'x' }).success).toBe(false);
    expect(createAssignmentSchema.safeParse({ ...validAssignment, timezone: 'Mars/Olympus' }).success).toBe(
      false,
    );
    expect(
      createAssignmentSchema.safeParse({
        ...validAssignment,
        submissionMethods: { text: false, file: false, url: false },
      }).success,
    ).toBe(false);
  });
  it('does not inject defaults into partial updates', () => {
    expect(updateAssignmentSchema.parse({ expectedRev: 3, title: 'New' })).toEqual({
      expectedRev: 3,
      title: 'New',
    });
  });
  it('rejects MongoDB operator injection in string fields', () => {
    expect(createAssignmentSchema.safeParse({ ...validAssignment, title: { $gt: '' } }).success).toBe(false);
  });
});

describe('auth schemas', () => {
  it('normalises email and rejects role fields on public registration', () => {
    const ok = registerSchema.parse({
      name: 'A',
      email: '  A@Example.EDU ',
      password: 'correct horse battery',
    });
    expect(ok.email).toBe('a@example.edu');
    expect(
      registerSchema.safeParse({
        name: 'A',
        email: 'a@x.edu',
        password: 'correct horse battery',
        role: 'org_admin',
      }).success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({
        name: 'A',
        email: 'a@x.edu',
        password: 'correct horse battery',
        platformRole: 'platform_admin',
      }).success,
    ).toBe(false);
  });
});

describe('common schemas', () => {
  it('only allows listed sort fields', () => {
    const s = sortSchema(['name', 'dueAt'], 'name');
    expect(s.parse(undefined)).toBe('name');
    expect(s.parse('-dueAt')).toBe('-dueAt');
    expect(s.safeParse('password').success).toBe(false);
    expect(s.safeParse('$where').success).toBe(false);
  });
  it('requires exactly one of userId/email on enrolment', () => {
    expect(addEnrollmentSchema.safeParse({}).success).toBe(false);
    expect(
      addEnrollmentSchema.safeParse({ email: 'x@y.edu', userId: '0123456789abcdef01234567' }).success,
    ).toBe(false);
    expect(addEnrollmentSchema.safeParse({ email: 'x@y.edu' }).success).toBe(true);
  });
  it('validates announcement audience rules', () => {
    expect(createAnnouncementSchema.safeParse({ title: 't', body: 'b', audience: 'course' }).success).toBe(
      false,
    );
    expect(createAnnouncementSchema.safeParse({ title: 't', body: 'b', audience: 'org_all' }).success).toBe(
      true,
    );
  });
});

describe('validation messages', () => {
  const firstMessage = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
    r.success ? null : r.error?.issues[0]?.message;
  it('reads as plain language rather than library jargon', () => {
    const settings = orgSettingsSchema.shape;
    expect(firstMessage(settings.notificationRetentionDays.safeParse(0))).toBe('Must be at least 7');
    expect(firstMessage(settings.reminderOffsetsMinutes.safeParse([99_999]))).toBe('Must be at most 20160');
    expect(firstMessage(settings.reminderOffsetsMinutes.safeParse([60, 120, 180, 240, 300, 360]))).toBe(
      'Use at most 5',
    );
    expect(firstMessage(registerSchema.safeParse({}))).toBe('Required');
  });
});
