import { isIPv4, isIPv6 } from 'node:net';
import type { Request } from 'express';
import { errors } from './errors';

export function requireAuth(req: Request): NonNullable<Request['auth']> {
  if (!req.auth) throw errors.unauthenticated();
  return req.auth;
}

export function requireOrg(req: Request): NonNullable<Request['org']> {
  if (!req.org) throw errors.forbidden();
  return req.org;
}

/** Expands an IPv6 address ("2001:db8::1") to its eight groups, or null when it is not valid IPv6. */
function ipv6Groups(ip: string): string[] | null {
  const addr = ip.split('%')[0] ?? ''; // drop a zone id such as %eth0
  if (!isIPv6(addr)) return null;
  const halves = addr.split('::');
  const head = halves[0] ? halves[0].split(':') : [];
  if (halves.length === 1) return head;
  const tail = halves[1] ? halves[1].split(':') : [];
  return [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail];
}

/** Truncated client IP used for session display and security analytics (never the full address). */
export function ipPrefix(ip: string | undefined): string {
  if (!ip) return '';
  const v4 = ip.replace(/^::ffff:/i, '');
  if (isIPv4(v4)) return `${v4.split('.').slice(0, 3).join('.')}.0/24`;
  const groups = ipv6Groups(ip);
  if (!groups) return '';
  const prefix = groups.slice(0, 3).map((g) => parseInt(g, 16).toString(16));
  return prefix.every((g) => g === '0') ? '::/48' : `${prefix.join(':')}::/48`;
}

export function userAgent(req: Request): string {
  return (req.get('user-agent') ?? '').slice(0, 300);
}
