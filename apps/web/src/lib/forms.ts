import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';
import { ApiError } from './api';

/**
 * Maps a server validation error onto react-hook-form fields (server rules are authoritative and may be
 * stricter than client checks). Returns a message for a form-level alert, or null when every problem was
 * attached to a visible field.
 */
export function applyServerErrors<T extends FieldValues>(form: UseFormReturn<T>, error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.';
  let unmatched = false;
  for (const [field, messages] of Object.entries(error.fields)) {
    if (field === '_root') {
      unmatched = true;
      continue;
    }
    const name = field as Path<T>;
    try {
      form.setError(name, { type: 'server', message: messages[0] }, { shouldFocus: true });
    } catch {
      unmatched = true;
    }
  }
  return Object.keys(error.fields).length === 0 || unmatched
    ? (error.fields._root?.[0] ?? error.message)
    : error.message;
}

/** Reads a one-time token from the URL fragment (#token=…) and removes it from the address bar and history. */
export function consumeHashToken(): string | null {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get('token');
  if (token) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return token;
}

const MAX_REMINDERS = 5;
const MIN_REMINDER_MINUTES = 5;
const MAX_REMINDER_MINUTES = 14 * 24 * 60;

/**
 * Parses reminder times typed as hours ("24, 1, 0.5") into minutes, largest first. Anything that is not a
 * number in range is reported rather than dropped, so a typo can never silently turn reminders off.
 */
export function parseReminderHours(text: string): { minutes: number[] } | { error: string } {
  const parts = text
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > MAX_REMINDERS) return { error: `Use at most ${MAX_REMINDERS} reminder times.` };
  const minutes = new Set<number>();
  for (const part of parts) {
    if (!/^\d+(\.\d+)?$/.test(part)) return { error: `"${part}" is not a number of hours.` };
    const m = Math.round(Number(part) * 60);
    if (m < MIN_REMINDER_MINUTES || m > MAX_REMINDER_MINUTES) {
      return {
        error: `${part} hours is out of range: use between 0.1 hours (5 minutes) and 336 hours (14 days).`,
      };
    }
    minutes.add(m);
  }
  return { minutes: [...minutes].sort((a, b) => b - a) };
}
