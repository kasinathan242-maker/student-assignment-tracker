import type { SubmissionDisplayStatus, SubmissionState } from '../enums';
import type { SubmissionTiming } from './deadline';

/**
 * Submission state machine (persisted states):
 *
 *   (none) ──save draft──▶ draft ──submit──▶ submitted ──publish grade──▶ graded
 *                            ▲                 │  │                         │
 *                            │          withdraw  └──return for revision──▶ returned
 *                            │                 ▼                            │
 *                            └───────────── withdrawn ◀───────────────────── │ (resubmit → submitted)
 *
 * Rules
 *  - submit:   allowed from draft, withdrawn, returned; from submitted only when resubmission is allowed
 *              and attempts remain. A teacher's explicit return-for-revision always grants one more attempt.
 *              From graded only after the teacher returns the work.
 *  - withdraw: allowed from submitted while the deadline still permits submitting (never after grading).
 *  - return:   teacher action from submitted or graded.
 *  - grade:    publishing a grade moves submitted → graded; a grade on returned work is not allowed.
 * "late" and "resubmitted" are attributes of the current version, not separate states.
 */

export interface ResubmissionPolicy {
  allowed: boolean;
  /** Maximum total attempts including the first. null = unlimited. */
  maxAttempts: number | null;
}

export interface SubmitEligibilityInput {
  state: SubmissionState | null;
  attemptCount: number;
  resubmission: ResubmissionPolicy;
  timing: Pick<SubmissionTiming, 'allowed' | 'reason'>;
}

export type SubmitIneligibleReason =
  'deadline' | 'already_submitted' | 'attempts_exhausted' | 'already_graded';

export function canSubmit(
  input: SubmitEligibilityInput,
): { ok: true } | { ok: false; reason: SubmitIneligibleReason } {
  if (!input.timing.allowed) return { ok: false, reason: 'deadline' };
  const { state, attemptCount, resubmission } = input;
  if (state === 'graded') return { ok: false, reason: 'already_graded' };
  if (state === 'returned') return { ok: true };
  if (state === 'submitted') {
    if (!resubmission.allowed) return { ok: false, reason: 'already_submitted' };
    if (resubmission.maxAttempts != null && attemptCount >= resubmission.maxAttempts) {
      return { ok: false, reason: 'attempts_exhausted' };
    }
    return { ok: true };
  }
  // Withdrawing does not refund an attempt when a finite attempt budget applies. Under a
  // single-submission policy the withdrawn attempt is not "active", so one replacement is allowed.
  if (
    state === 'withdrawn' &&
    resubmission.allowed &&
    resubmission.maxAttempts != null &&
    attemptCount >= resubmission.maxAttempts
  ) {
    return { ok: false, reason: 'attempts_exhausted' };
  }
  return { ok: true };
}

export function canEditDraft(state: SubmissionState | null): boolean {
  return state !== 'graded';
}

export function canWithdraw(state: SubmissionState | null, timingAllowed: boolean): boolean {
  return state === 'submitted' && timingAllowed;
}

export function canReturnForRevision(state: SubmissionState | null): boolean {
  return state === 'submitted' || state === 'graded';
}

export function canGrade(state: SubmissionState | null): boolean {
  return state === 'submitted' || state === 'graded';
}

export interface DisplayStatusInput {
  state: SubmissionState | null;
  isLate: boolean;
  attemptCount: number;
  gradeVisible: boolean;
  now: Date;
  effectiveDueAt: Date;
  /** Whether new submissions are still accepted for this student. */
  stillAccepting: boolean;
}

/** Student-facing status. "missing" = nothing submitted and no longer accepted; "overdue" = past due but still accepted. */
export function displayStatus(input: DisplayStatusInput): SubmissionDisplayStatus {
  const { state } = input;
  if (state === 'graded') return input.gradeVisible ? 'graded' : 'submitted';
  if (state === 'returned') return 'returned';
  if (state === 'submitted') {
    if (input.isLate) return 'late';
    return input.attemptCount > 1 ? 'resubmitted' : 'submitted';
  }
  const pastDue = input.now.getTime() > input.effectiveDueAt.getTime();
  if (pastDue) return input.stillAccepting ? 'overdue' : 'missing';
  if (state === 'withdrawn') return 'withdrawn';
  if (state === 'draft') return 'draft';
  return 'not_started';
}

export const SUBMIT_INELIGIBLE_MESSAGES: Record<SubmitIneligibleReason, string> = {
  deadline: 'Submissions are not being accepted for this assignment.',
  already_submitted: 'You have already submitted. This assignment does not allow resubmission.',
  attempts_exhausted: 'You have used all permitted submission attempts.',
  already_graded:
    'This submission has been graded. Ask your instructor to return it if you need to revise it.',
};
