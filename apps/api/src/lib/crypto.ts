import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** 256-bit URL-safe random token for emails, invitations and refresh sessions. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Tokens are high-entropy random values, so a fast SHA-256 digest is sufficient for storage at rest
 * (unlike passwords, they cannot be brute-forced from the hash).
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function hmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value, 'utf8').digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const RECEIPT_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Human-readable submission receipt, e.g. "SAT-7K2M-QX9D". */
export function receiptCode(): string {
  const pick = () => RECEIPT_ALPHABET[randomInt(RECEIPT_ALPHABET.length)];
  const block = () => Array.from({ length: 4 }, pick).join('');
  return `SAT-${block()}-${block()}`;
}

export function joinCode(): string {
  const pick = () => RECEIPT_ALPHABET[randomInt(RECEIPT_ALPHABET.length)];
  return Array.from({ length: 8 }, pick).join('');
}
