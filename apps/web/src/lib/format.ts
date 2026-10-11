import { DateTime } from 'luxon';
import type { AssignmentType, SubmissionDisplayStatus } from '@sat/shared';

export const browserZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

let userZone = browserZone();
/** Set from the signed-in user's profile so every date renders in their chosen time zone. */
export function setDisplayZone(zone: string | undefined): void {
  userZone = zone && DateTime.local().setZone(zone).isValid ? zone : browserZone();
}
export const displayZone = () => userZone;

const dt = (iso: string | Date, zone = userZone) =>
  (iso instanceof Date ? DateTime.fromJSDate(iso) : DateTime.fromISO(iso)).setZone(zone);

export function formatDateTime(iso: string | Date | null | undefined, zone?: string): string {
  if (!iso) return 'Not set';
  return dt(iso, zone).toFormat('ccc d LLL yyyy, HH:mm ZZZZ');
}
export function formatDate(iso: string | Date | null | undefined, zone?: string): string {
  if (!iso) return 'Not set';
  return dt(iso, zone).toFormat('d LLL yyyy');
}
export function formatShort(iso: string | Date, zone?: string): string {
  const d = dt(iso, zone);
  return d.hasSame(DateTime.now().setZone(d.zone), 'year')
    ? d.toFormat('d LLL, HH:mm')
    : d.toFormat('d LLL yyyy');
}
/** Month and day for calendar-style date tiles, in the user's time zone ("Oct", "11"). */
export function dayParts(iso: string | Date, zone?: string): { month: string; day: string; label: string } {
  const d = dt(iso, zone);
  return { month: d.toFormat('LLL'), day: d.toFormat('d'), label: d.toFormat('cccc d LLLL') };
}
/** Today's date as a sentence-case line for page headers ("Sunday, 11 October"). */
export function todayLine(now = new Date()): string {
  return DateTime.fromJSDate(now).setZone(userZone).toFormat('cccc, d LLLL');
}
export function formatRelative(iso: string | Date | null | undefined, now = new Date()): string {
  if (!iso) return '';
  return dt(iso).toRelative({ base: DateTime.fromJSDate(now) }) ?? '';
}

/** "datetime-local" input value (wall time in the given zone) ⇄ ISO instant. DST-safe via Luxon. */
export function toLocalInput(iso: string | null | undefined, zone = userZone): string {
  return iso ? dt(iso, zone).toFormat("yyyy-LL-dd'T'HH:mm") : '';
}
export function fromLocalInput(value: string, zone = userZone): string | null {
  if (!value) return null;
  const parsed = DateTime.fromISO(value, { zone });
  return parsed.isValid ? (parsed.toUTC().toISO() as string) : null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatPoints(points: number | null | undefined, max?: number): string {
  if (points == null) return 'Not graded';
  const p = Number.isInteger(points)
    ? String(points)
    : points.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return max != null ? `${p} / ${max}` : p;
}

export const STATUS_LABEL: Record<SubmissionDisplayStatus, string> = {
  not_started: 'Not started',
  draft: 'Draft saved',
  submitted: 'Submitted',
  late: 'Submitted late',
  resubmitted: 'Resubmitted',
  returned: 'Needs revision',
  graded: 'Graded',
  withdrawn: 'Withdrawn',
  overdue: 'Overdue',
  missing: 'Missing',
};

export const TYPE_LABEL: Record<AssignmentType, string> = {
  homework: 'Homework',
  essay: 'Essay',
  project: 'Project',
  lab: 'Lab',
  quiz: 'Quiz',
  presentation: 'Presentation',
  other: 'Other',
};

export const ROLE_LABEL = { student: 'Student', teacher: 'Teacher', org_admin: 'Administrator' } as const;

const HONORIFICS = new Set(['dr', 'prof', 'professor', 'mr', 'mrs', 'ms', 'mx', 'miss', 'sir', 'dame']);

/** The name to greet someone by: the first word of their name that is not a title ("Prof. Priya Raman" → "Priya"). */
export function greetingName(fullName: string | null | undefined): string {
  const words = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  return words.find((w) => !HONORIFICS.has(w.replace(/\.$/, '').toLowerCase())) ?? words[0] ?? '';
}
