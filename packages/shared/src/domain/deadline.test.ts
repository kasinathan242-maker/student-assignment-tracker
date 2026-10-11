import { describe, expect, it } from 'vitest';
import { computeCutoff, evaluateSubmissionTiming, latePenaltyPoints, type DeadlineSubject } from './deadline';

const due = new Date('2026-03-08T06:59:00Z'); // just before the US DST switch
const minutes = (n: number) => new Date(due.getTime() + n * 60_000);

function subject(overrides: Partial<DeadlineSubject> = {}): DeadlineSubject {
  return {
    status: 'published',
    availableFrom: null,
    dueAt: due,
    availableUntil: null,
    gracePeriodMinutes: 0,
    latePolicy: { mode: 'reject', penaltyPercentPerDay: 0, maxLateDays: null },
    ...overrides,
  };
}

describe('evaluateSubmissionTiming', () => {
  it('accepts exactly at the deadline and rejects one millisecond after under a reject policy', () => {
    expect(evaluateSubmissionTiming(subject(), due)).toMatchObject({ allowed: true, isLate: false });
    const after = evaluateSubmissionTiming(subject(), new Date(due.getTime() + 1));
    expect(after).toMatchObject({ allowed: false, reason: 'past_cutoff', isLate: true });
  });

  it('treats the grace period as on time, inclusive of its boundary', () => {
    const s = subject({ gracePeriodMinutes: 10 });
    expect(evaluateSubmissionTiming(s, minutes(10))).toMatchObject({ allowed: true, isLate: false });
    expect(evaluateSubmissionTiming(s, minutes(11))).toMatchObject({ allowed: false, reason: 'past_cutoff' });
  });

  it('accepts late work under an accept policy and measures lateness from the due time', () => {
    const s = subject({
      gracePeriodMinutes: 15,
      latePolicy: { mode: 'accept', penaltyPercentPerDay: 0, maxLateDays: null },
    });
    const t = evaluateSubmissionTiming(s, minutes(20));
    expect(t).toMatchObject({ allowed: true, isLate: true, lateByMinutes: 20, cutoffAt: null });
  });

  it('caps late acceptance by maxLateDays', () => {
    const s = subject({ latePolicy: { mode: 'penalize', penaltyPercentPerDay: 10, maxLateDays: 2 } });
    expect(evaluateSubmissionTiming(s, minutes(2 * 24 * 60)).allowed).toBe(true);
    expect(evaluateSubmissionTiming(s, minutes(2 * 24 * 60 + 1)).reason).toBe('past_cutoff');
  });

  it('enforces availableUntil as a hard close unless the student has an extension', () => {
    const s = subject({
      availableUntil: minutes(60),
      latePolicy: { mode: 'accept', penaltyPercentPerDay: 0, maxLateDays: null },
    });
    expect(evaluateSubmissionTiming(s, minutes(61)).reason).toBe('past_cutoff');
    const ext = minutes(3 * 24 * 60);
    const withExt = evaluateSubmissionTiming(s, minutes(2 * 24 * 60), ext);
    expect(withExt).toMatchObject({ allowed: true, isLate: false });
    expect(withExt.effectiveDueAt).toEqual(ext);
  });

  it('blocks drafts, scheduled, archived and not-yet-available assignments', () => {
    expect(evaluateSubmissionTiming(subject({ status: 'draft' }), minutes(-5)).reason).toBe('not_published');
    expect(evaluateSubmissionTiming(subject({ status: 'scheduled' }), minutes(-5)).reason).toBe(
      'not_published',
    );
    expect(evaluateSubmissionTiming(subject({ status: 'archived' }), minutes(-5)).reason).toBe('archived');
    const s = subject({ availableFrom: minutes(-10) });
    expect(evaluateSubmissionTiming(s, minutes(-11)).reason).toBe('not_yet_available');
    expect(evaluateSubmissionTiming(s, minutes(-10)).allowed).toBe(true);
  });

  it('rejects closed assignments except for students holding an extension', () => {
    const s = subject({ status: 'closed' });
    expect(evaluateSubmissionTiming(s, minutes(-60)).reason).toBe('closed');
    expect(evaluateSubmissionTiming(s, minutes(60), minutes(120)).allowed).toBe(true);
    expect(evaluateSubmissionTiming(s, minutes(121), minutes(120)).reason).toBe('past_cutoff');
  });

  it('works in absolute instants across a DST transition', () => {
    // 2026-03-08 is the US spring-forward day; one wall-clock hour is skipped but instants are unaffected.
    const t = evaluateSubmissionTiming(
      subject({ latePolicy: { mode: 'accept', penaltyPercentPerDay: 0, maxLateDays: 1 } }),
      minutes(120),
    );
    expect(t.lateByMinutes).toBe(120);
    expect(
      computeCutoff(
        subject({ latePolicy: { mode: 'accept', penaltyPercentPerDay: 0, maxLateDays: 1 } }),
      )?.toISOString(),
    ).toBe('2026-03-09T06:59:00.000Z');
  });
});

describe('latePenaltyPoints', () => {
  const policy = { mode: 'penalize' as const, penaltyPercentPerDay: 10, maxLateDays: null };
  it('charges per started day', () => {
    expect(latePenaltyPoints(80, 1, policy)).toBe(8);
    expect(latePenaltyPoints(80, 24 * 60, policy)).toBe(8);
    expect(latePenaltyPoints(80, 24 * 60 + 1, policy)).toBe(16);
  });
  it('never exceeds the earned points and is zero for other modes', () => {
    expect(latePenaltyPoints(50, 30 * 24 * 60, policy)).toBe(50);
    expect(latePenaltyPoints(50, 600, { ...policy, mode: 'accept' })).toBe(0);
    expect(latePenaltyPoints(0, 600, policy)).toBe(0);
  });
});
