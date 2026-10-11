import { describe, expect, it } from 'vitest';
import { parseEnv } from '../config/env';
import { sanitizeMetadata } from '../services/audit';
import { sanitizeFilename } from '../services/files';
import { backoffMs } from '../services/outbox';
import { assertSafeKey } from '../services/storage';
import { csvCell, toCsv } from './csv';
import { hashToken, receiptCode } from './crypto';
import { buildIcs, escapeIcsText, foldLine } from './ics';
import { REDACT_PATHS, maskEmail } from './logger';
import { seal, unseal } from './seal';
import { ipPrefix } from './request';

describe('environment validation', () => {
  const base = { MONGO_URI: 'mongodb://localhost/x' };
  it('accepts development defaults', () => {
    expect(parseEnv({ ...base, NODE_ENV: 'development' }).EMAIL_PROVIDER).toBe('file');
  });
  it('fails fast on missing production secrets instead of using defaults', () => {
    expect(() => parseEnv({ ...base, NODE_ENV: 'production' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() =>
      parseEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'a'.repeat(40),
        CSRF_SECRET: 'a'.repeat(40),
        COOKIE_SECURE: 'true',
        EMAIL_PROVIDER: 'smtp',
        SMTP_HOST: 'smtp.example.org',
      }),
    ).toThrow(/must differ/);
    const ok = parseEnv({
      ...base,
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'a'.repeat(40),
      CSRF_SECRET: 'b'.repeat(40),
      COOKIE_SECURE: 'true',
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.example.org',
    });
    expect(ok.isProduction).toBe(true);
  });
  it('refuses the dev mailbox and insecure cookies in production', () => {
    const prod = {
      ...base,
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'a'.repeat(40),
      CSRF_SECRET: 'b'.repeat(40),
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'h',
    };
    expect(() => parseEnv({ ...prod, COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
    expect(() => parseEnv({ ...prod, COOKIE_SECURE: 'true', DEV_MAILBOX_ENABLED: 'true' })).toThrow(
      /DEV_MAILBOX_ENABLED/,
    );
  });
  it('treats empty values from an env file as unset', () => {
    const parsed = parseEnv({ ...base, JWT_ACCESS_SECRET: '', SMTP_PORT: '', REDIS_URL: '' });
    expect(parsed.SMTP_PORT).toBeUndefined();
    expect(parsed.REDIS_URL).toBeUndefined();
    expect(parsed.JWT_ACCESS_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(() => parseEnv({ ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: '' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });
  it('requires a database URI', () => {
    expect(() => parseEnv({})).toThrow(/MONGO_URI/);
  });
});

describe('CSV', () => {
  it('escapes delimiters and neutralises formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell(null)).toBe('');
    expect(toCsv(['a'], [[1]])).toBe('a\r\n1\r\n');
  });
});

describe('ICS', () => {
  it('escapes text, folds long lines and writes UTC instants', () => {
    expect(escapeIcsText('a,b;c\nd')).toBe('a\\,b\\;c\\nd');
    const folded = foldLine(`SUMMARY:${'x'.repeat(200)}`);
    expect(folded.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    const ics = buildIcs(
      'Cal',
      [{ uid: 'u1', start: new Date('2026-03-08T07:30:00Z'), summary: 'Essay, final' }],
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(ics).toContain('DTSTART:20260308T073000Z');
    expect(ics).toContain('SUMMARY:Essay\\, final');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});

describe('crypto helpers', () => {
  it('seals and unseals, rejecting tampering', () => {
    const sealed = seal('reset-token-123');
    expect(sealed).not.toContain('reset-token-123');
    expect(unseal(sealed)).toBe('reset-token-123');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => unseal(parts.join('.'))).toThrow();
  });
  it('hashes tokens deterministically and generates receipt codes', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe('abc');
    expect(receiptCode()).toMatch(/^SAT-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });
});

describe('file safety', () => {
  it('strips paths and control characters from file names', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\Users\\x\\report.pdf')).toBe('report.pdf');
    expect(sanitizeFilename('a<b>:c|d?.txt')).toBe('a_b__c_d_.txt');
    expect(sanitizeFilename('\u0000\u0001')).toBe('__');
    expect(sanitizeFilename('...')).toBe('file');
  });
  it('rejects unsafe storage keys', () => {
    expect(() => assertSafeKey('org/submission/2026/01/abcdef12-3456')).not.toThrow();
    for (const bad of [
      '../etc/passwd',
      '/abs/path/123456789',
      'org//double/12345678',
      'UPPER/case/123456789',
    ]) {
      expect(() => assertSafeKey(bad)).toThrow();
    }
  });
});

describe('logging and audit redaction', () => {
  it('redacts secrets from audit metadata and covers credentials in log paths', () => {
    expect(sanitizeMetadata({ password: 'x', token: 'y', nested: { refreshToken: 'z', ok: 1 } })).toEqual({
      password: '[redacted]',
      token: '[redacted]',
      nested: { refreshToken: '[redacted]', ok: 1 },
    });
    expect(REDACT_PATHS).toEqual(
      expect.arrayContaining(['req.headers.cookie', 'req.headers.authorization', '*.password']),
    );
    expect(maskEmail('jordan@example.edu')).toBe('j***@example.edu');
  });
});

describe('retry backoff', () => {
  it('grows exponentially with jitter and is capped', () => {
    for (let i = 0; i < 50; i += 1) {
      const first = backoffMs(1);
      expect(first).toBeGreaterThanOrEqual(2500);
      expect(first).toBeLessThanOrEqual(5000);
    }
    expect(backoffMs(30)).toBeLessThanOrEqual(30 * 60_000);
  });
});

describe('ipPrefix', () => {
  it('keeps only the network part of IPv4 and IPv6 addresses', () => {
    expect(ipPrefix('203.0.113.77')).toBe('203.0.113.0/24');
    expect(ipPrefix('::ffff:203.0.113.77')).toBe('203.0.113.0/24');
    expect(ipPrefix('2001:db8:abcd:12::1')).toBe('2001:db8:abcd::/48');
    // Compressed forms used to produce invalid prefixes such as "::1::/48" and "2001:db8:::/48".
    expect(ipPrefix('::1')).toBe('::/48');
    expect(ipPrefix('2001:db8::1')).toBe('2001:db8:0::/48');
    expect(ipPrefix('fe80::1%eth0')).toBe('fe80:0:0::/48');
    expect(ipPrefix('not-an-ip')).toBe('');
    expect(ipPrefix(undefined)).toBe('');
  });
});
