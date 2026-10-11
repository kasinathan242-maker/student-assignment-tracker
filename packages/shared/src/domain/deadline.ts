import type { AssignmentStatus, LatePolicyMode } from '../enums';

/**
 * Deadline policy — the single authoritative implementation used by the API when accepting
 * submissions and by the web app when *displaying* expected outcomes. Server time is authoritative:
 * the API evaluates every submission against the instant the request was received (see
 * docs/domain-rules.md), never against a client-supplied clock.
 *
 * Definitions
 *  - effectiveDueAt: the student's approved extension deadline if one exists, otherwise the assignment dueAt.
 *  - lateThreshold:  effectiveDueAt + grace period. A submission at or before this instant is on time.
 *  - cutoffAt:       the last instant a submission is accepted at all (null = no cutoff).
 *      * latePolicy "reject":   cutoff = lateThreshold.
 *      * "accept"/"penalize":   cutoff = effectiveDueAt + maxLateDays (+ grace) when maxLateDays is set.
 *      * availableUntil (hard close) further caps the cutoff for students WITHOUT an extension.
 *        An approved extension supersedes availableUntil for that student.
 *  - Lateness is measured from effectiveDueAt (the grace period forgives, it does not shift the clock).
 *  - Boundaries are inclusive: submitting exactly at lateThreshold is on time; exactly at cutoffAt is accepted.
 */

export interface LatePolicy {
  mode: LatePolicyMode;
  /** Percentage of the earned points deducted per started day late ("penalize" only). */
  penaltyPercentPerDay: number;
  /** Maximum days late that are still accepted. null = unlimited ("accept"/"penalize"). */
  maxLateDays: number | null;
}

export interface DeadlineSubject {
  status: AssignmentStatus;
  availableFrom: Date | null;
  dueAt: Date;
  availableUntil: Date | null;
  gracePeriodMinutes: number;
  latePolicy: LatePolicy;
}

export type SubmissionBlockReason =
  'not_published' | 'archived' | 'not_yet_available' | 'closed' | 'past_cutoff';

export interface SubmissionTiming {
  allowed: boolean;
  reason: SubmissionBlockReason | null;
  isLate: boolean;
  /** Whole minutes after effectiveDueAt (0 when on time). */
  lateByMinutes: number;
  effectiveDueAt: Date;
  lateThreshold: Date;
  cutoffAt: Date | null;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export function effectiveDueAt(subject: Pick<DeadlineSubject, 'dueAt'>, extensionDueAt?: Date | null): Date {
  return extensionDueAt ?? subject.dueAt;
}

export function computeCutoff(subject: DeadlineSubject, extensionDueAt?: Date | null): Date | null {
  const due = effectiveDueAt(subject, extensionDueAt);
  const graceMs = subject.gracePeriodMinutes * MINUTE;
  let cutoff: number | null;
  if (subject.latePolicy.mode === 'reject') {
    cutoff = due.getTime() + graceMs;
  } else if (subject.latePolicy.maxLateDays != null) {
    cutoff = due.getTime() + graceMs + subject.latePolicy.maxLateDays * DAY;
  } else {
    cutoff = null;
  }
  if (!extensionDueAt && subject.availableUntil) {
    const hardClose = subject.availableUntil.getTime();
    cutoff = cutoff == null ? hardClose : Math.min(cutoff, hardClose);
  }
  return cutoff == null ? null : new Date(cutoff);
}

export function evaluateSubmissionTiming(
  subject: DeadlineSubject,
  at: Date,
  extensionDueAt?: Date | null,
): SubmissionTiming {
  const due = effectiveDueAt(subject, extensionDueAt);
  const lateThreshold = new Date(due.getTime() + subject.gracePeriodMinutes * MINUTE);
  const cutoffAt = computeCutoff(subject, extensionDueAt);
  const isLate = at.getTime() > lateThreshold.getTime();
  const lateByMinutes = isLate ? Math.ceil((at.getTime() - due.getTime()) / MINUTE) : 0;
  const base = { isLate, lateByMinutes, effectiveDueAt: due, lateThreshold, cutoffAt };

  const block = (reason: SubmissionBlockReason): SubmissionTiming => ({ ...base, allowed: false, reason });

  if (subject.status === 'archived') return block('archived');
  if (subject.status === 'draft' || subject.status === 'scheduled') return block('not_published');
  // A manually closed assignment only accepts students who hold an approved extension.
  if (subject.status === 'closed' && !extensionDueAt) return block('closed');
  if (subject.availableFrom && at.getTime() < subject.availableFrom.getTime())
    return block('not_yet_available');
  if (cutoffAt && at.getTime() > cutoffAt.getTime()) return block('past_cutoff');
  return { ...base, allowed: true, reason: null };
}

/** Points deducted for a late submission under a "penalize" policy, rounded to 2 decimals. */
export function latePenaltyPoints(earnedPoints: number, lateByMinutes: number, policy: LatePolicy): number {
  if (policy.mode !== 'penalize' || lateByMinutes <= 0 || earnedPoints <= 0) return 0;
  const daysLate = Math.ceil(lateByMinutes / (24 * 60));
  const percent = Math.min(100, daysLate * policy.penaltyPercentPerDay);
  return Math.round(earnedPoints * percent) / 100;
}

export const SUBMISSION_BLOCK_MESSAGES: Record<SubmissionBlockReason, string> = {
  not_published: 'This assignment is not open for submissions yet.',
  archived: 'This assignment has been archived.',
  not_yet_available: 'Submissions open later. Check the availability date.',
  closed: 'Your instructor has closed submissions for this assignment.',
  past_cutoff: 'The submission deadline has passed and late work is no longer accepted.',
};
