import pino, { type Logger } from 'pino';
import { env } from '../config/env';

/**
 * Structured JSON logger. Redaction covers credentials, tokens, cookies and free-text bodies; request
 * bodies are never logged by default.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'req.headers["idempotency-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.passwordHash',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.tokenHash',
  '*.secret',
  '*.html',
  '*.text',
  'email.html',
  'email.text',
];

let instance: Logger | null = null;

export function logger(): Logger {
  if (instance) return instance;
  const config = env();
  instance = pino({
    level: config.LOG_LEVEL ?? (config.isTest ? 'silent' : config.isProduction ? 'info' : 'debug'),
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    base: { service: 'sat-api', version: config.APP_VERSION },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    transport:
      !config.isProduction && !config.isTest && process.stdout.isTTY
        ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' } }
        : undefined,
  });
  return instance;
}

/** Masks an email for logs: "jordan@example.edu" → "j***@example.edu". */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}
