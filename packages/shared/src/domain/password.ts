import { LIMITS } from '../constants';

/**
 * Unicode passwords are normalised to NFC before hashing and comparison so that visually identical
 * input typed on different platforms (composed vs decomposed accents) produces the same hash.
 */
export function normalizePassword(password: string): string {
  return password.normalize('NFC');
}

const COMMON_PASSWORDS = new Set([
  'password1234',
  'password12345',
  '123456789012',
  'qwertyuiop12',
  'letmein12345',
  'welcome12345',
  'iloveyou1234',
  'administrator',
  'passwordpassword',
  'changeme1234',
  '1q2w3e4r5t6y',
  'qwerty123456',
  'abc123456789',
]);

/** Returns human-readable problems with a proposed password; an empty array means it is acceptable. */
export function passwordIssues(password: string, context: { email?: string; name?: string } = {}): string[] {
  const issues: string[] = [];
  const normalized = normalizePassword(password);
  const length = [...normalized].length;
  if (length < LIMITS.passwordMin) issues.push(`Use at least ${LIMITS.passwordMin} characters.`);
  if (length > LIMITS.passwordMax) issues.push(`Use at most ${LIMITS.passwordMax} characters.`);
  if (normalized.trim().length === 0) issues.push('Password cannot be only spaces.');
  if (/^(.)\1+$/u.test(normalized)) issues.push('Password cannot be a single repeated character.');
  const lower = normalized.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) issues.push('This password is too common.');
  const localPart = context.email?.split('@')[0]?.toLowerCase();
  if (localPart && localPart.length >= 4 && lower.includes(localPart)) {
    issues.push('Password must not contain your email address.');
  }
  return issues;
}
