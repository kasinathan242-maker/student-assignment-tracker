import { describe, expect, it } from 'vitest';
import { canTransitionAssignment, nextAssignmentStatus } from './assignmentLifecycle';
import { computeFinalScore, validateGrade } from './grading';
import { passwordIssues } from './password';
import { reminderDedupeKey, selectReminderOffset } from './reminders';
import { canSubmit, canWithdraw, displayStatus } from './submissionState';

describe('assignment lifecycle', () => {
  it('allows only defined transitions', () => {
    expect(nextAssignmentStatus('draft', 'publish', { wasEverPublished: false })).toBe('published');
    expect(nextAssignmentStatus('draft', 'schedule', { wasEverPublished: false })).toBe('scheduled');
    expect(nextAssignmentStatus('published', 'close', { wasEverPublished: true })).toBe('closed');
    expect(nextAssignmentStatus('closed', 'reopen', { wasEverPublished: true })).toBe('published');
    expect(nextAssignmentStatus('published', 'publish', { wasEverPublished: true })).toBeNull();
    expect(nextAssignmentStatus('archived', 'close', { wasEverPublished: true })).toBeNull();
    expect(canTransitionAssignment('published', 'unschedule')).toBe(false);
  });
  it('restores archived assignments to closed only if they were ever published', () => {
    expect(nextAssignmentStatus('archived', 'restore', { wasEverPublished: true })).toBe('closed');
    expect(nextAssignmentStatus('archived', 'restore', { wasEverPublished: false })).toBe('draft');
  });
});

describe('submission state machine', () => {
  const open = { allowed: true, reason: null };
  const single = { allowed: false, maxAttempts: null };
  it('blocks when the deadline does not allow submission', () => {
    expect(
      canSubmit({
        state: 'draft',
        attemptCount: 0,
        resubmission: single,
        timing: { allowed: false, reason: 'past_cutoff' },
      }),
    ).toEqual({
      ok: false,
      reason: 'deadline',
    });
  });
  it('enforces single-submission policies', () => {
    expect(canSubmit({ state: null, attemptCount: 0, resubmission: single, timing: open }).ok).toBe(true);
    expect(canSubmit({ state: 'submitted', attemptCount: 1, resubmission: single, timing: open })).toEqual({
      ok: false,
      reason: 'already_submitted',
    });
  });
  it('enforces attempt budgets, including after withdrawal', () => {
    const two = { allowed: true, maxAttempts: 2 };
    expect(canSubmit({ state: 'submitted', attemptCount: 1, resubmission: two, timing: open }).ok).toBe(true);
    expect(canSubmit({ state: 'submitted', attemptCount: 2, resubmission: two, timing: open })).toEqual({
      ok: false,
      reason: 'attempts_exhausted',
    });
    expect(canSubmit({ state: 'withdrawn', attemptCount: 2, resubmission: two, timing: open }).ok).toBe(
      false,
    );
    expect(canSubmit({ state: 'withdrawn', attemptCount: 1, resubmission: single, timing: open }).ok).toBe(
      true,
    );
  });
  it('lets a returned submission be resubmitted regardless of policy but never a graded one', () => {
    expect(canSubmit({ state: 'returned', attemptCount: 5, resubmission: single, timing: open }).ok).toBe(
      true,
    );
    expect(
      canSubmit({
        state: 'graded',
        attemptCount: 1,
        resubmission: { allowed: true, maxAttempts: null },
        timing: open,
      }),
    ).toEqual({
      ok: false,
      reason: 'already_graded',
    });
  });
  it('allows withdrawal only of submitted work within the deadline', () => {
    expect(canWithdraw('submitted', true)).toBe(true);
    expect(canWithdraw('submitted', false)).toBe(false);
    expect(canWithdraw('graded', true)).toBe(false);
  });
  it('derives student-facing statuses', () => {
    const base = {
      isLate: false,
      attemptCount: 0,
      gradeVisible: false,
      now: new Date('2026-01-02T00:00:00Z'),
      effectiveDueAt: new Date('2026-01-01T00:00:00Z'),
      stillAccepting: false,
    };
    expect(displayStatus({ ...base, state: null })).toBe('missing');
    expect(displayStatus({ ...base, state: 'draft', stillAccepting: true })).toBe('overdue');
    expect(displayStatus({ ...base, state: 'submitted', isLate: true, attemptCount: 1 })).toBe('late');
    expect(displayStatus({ ...base, state: 'submitted', attemptCount: 2 })).toBe('resubmitted');
    expect(displayStatus({ ...base, state: 'graded', attemptCount: 1 })).toBe('submitted');
    expect(displayStatus({ ...base, state: 'graded', attemptCount: 1, gradeVisible: true })).toBe('graded');
    expect(displayStatus({ ...base, state: null, now: new Date('2025-12-01T00:00:00Z') })).toBe(
      'not_started',
    );
  });
});

describe('grading', () => {
  const rubric = [
    { id: 'a', title: 'Analysis', maxPoints: 6, levels: [] },
    { id: 'b', title: 'Clarity', maxPoints: 4, levels: [] },
  ];
  it('sums rubric scores and validates per-criterion limits', () => {
    expect(
      validateGrade({
        maxPoints: 10,
        rubric,
        rubricScores: [
          { criterionId: 'a', points: 5.5 },
          { criterionId: 'b', points: 4 },
        ],
      }),
    ).toEqual({
      ok: true,
      rawPoints: 9.5,
    });
    const over = validateGrade({
      maxPoints: 10,
      rubric,
      rubricScores: [
        { criterionId: 'a', points: 7 },
        { criterionId: 'b', points: 1 },
      ],
    });
    expect(over.ok).toBe(false);
    const missing = validateGrade({ maxPoints: 10, rubric, rubricScores: [{ criterionId: 'a', points: 1 }] });
    expect(missing.ok).toBe(false);
    const unknown = validateGrade({
      maxPoints: 10,
      rubric,
      rubricScores: [
        { criterionId: 'a', points: 1 },
        { criterionId: 'b', points: 1 },
        { criterionId: 'zzz', points: 1 },
      ],
    });
    expect(unknown.ok).toBe(false);
  });
  it('validates direct points against the assignment maximum', () => {
    expect(validateGrade({ maxPoints: 25, points: 25 })).toEqual({ ok: true, rawPoints: 25 });
    expect(validateGrade({ maxPoints: 25, points: 25.01 }).ok).toBe(false);
    expect(validateGrade({ maxPoints: 25, points: -1 }).ok).toBe(false);
    expect(validateGrade({ maxPoints: 25, points: null }).ok).toBe(false);
  });
  it('applies late penalties to the final score', () => {
    expect(
      computeFinalScore(20, 25, 60, { mode: 'penalize', penaltyPercentPerDay: 10, maxLateDays: null }),
    ).toEqual({
      rawPoints: 20,
      latePenaltyPoints: 2,
      finalPoints: 18,
      percentage: 72,
    });
  });
});

describe('reminders', () => {
  const due = new Date('2026-05-01T12:00:00Z');
  const at = (hoursBefore: number) => new Date(due.getTime() - hoursBefore * 3_600_000);
  it('selects the most specific elapsed offset and nothing after the deadline', () => {
    expect(selectReminderOffset(due, [1440, 60], at(30))).toBeNull();
    expect(selectReminderOffset(due, [1440, 60], at(23))).toBe(1440);
    expect(selectReminderOffset(due, [1440, 60], at(0.5))).toBe(60);
    expect(selectReminderOffset(due, [1440, 60], at(0))).toBeNull();
    expect(selectReminderOffset(due, [1440, 60], at(-1))).toBeNull();
  });
  it('builds dedupe keys that change when the effective deadline changes', () => {
    expect(reminderDedupeKey('a', 60, due)).not.toBe(reminderDedupeKey('a', 60, at(-24)));
    expect(reminderDedupeKey('a', 60, due)).not.toBe(reminderDedupeKey('a', 1440, due));
  });
});

describe('passwords', () => {
  it('rejects short, common, repeated and email-containing passwords', () => {
    expect(passwordIssues('short')).not.toHaveLength(0);
    expect(passwordIssues('password1234')).toContain('This password is too common.');
    expect(passwordIssues('aaaaaaaaaaaaaa')).not.toHaveLength(0);
    expect(passwordIssues('jordan-the-student-2026', { email: 'jordan@example.edu' })).not.toHaveLength(0);
    expect(passwordIssues('correct horse battery staple')).toEqual([]);
  });
  it('counts characters, not UTF-16 units', () => {
    expect(passwordIssues('🔐🔐🔐🔐🔐🔐🔐🔐🔐🔐🔐x')).toEqual([]);
  });
});
