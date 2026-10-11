/**
 * Deadline reminder selection. Given reminder offsets (minutes before the effective deadline), returns the
 * single offset that should fire "now", or null.
 *
 *  - Only the most specific elapsed offset fires. If a worker was delayed past the 24h mark and runs 30
 *    minutes before the deadline, only the 1h reminder is sent — never a stale "due in 24 hours" message.
 *  - Nothing fires at or after the deadline.
 *  - Callers combine the returned offset with the effective deadline instant in an idempotency key, so a
 *    retried job never re-sends and a moved deadline (or new extension) produces fresh reminders.
 */
export function selectReminderOffset(
  effectiveDueAt: Date,
  offsetsMinutes: readonly number[],
  now: Date,
): number | null {
  const due = effectiveDueAt.getTime();
  const t = now.getTime();
  if (t >= due) return null;
  let selected: number | null = null;
  for (const offset of offsetsMinutes) {
    if (offset <= 0) continue;
    const fireAt = due - offset * 60_000;
    if (t >= fireAt && (selected == null || offset < selected)) selected = offset;
  }
  return selected;
}

/** Per-recipient idempotency key (notifications are unique per user + key). */
export function reminderDedupeKey(assignmentId: string, offsetMinutes: number, effectiveDueAt: Date) {
  return `reminder:${assignmentId}:${offsetMinutes}:${effectiveDueAt.toISOString()}`;
}

export function describeOffset(minutes: number): string {
  if (minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60);
    return days === 1 ? '24 hours' : `${days} days`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  return `${minutes} minutes`;
}
