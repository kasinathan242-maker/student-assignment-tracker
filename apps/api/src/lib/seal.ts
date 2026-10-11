import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { env } from '../config/env';

/**
 * Authenticated encryption (AES-256-GCM) for short-lived secrets that must transit a durable queue,
 * such as the link inside a password-reset email. The key is derived from JWT_ACCESS_SECRET with HKDF
 * and a purpose label, so it is never the signing key itself.
 */
function key(): Buffer {
  return Buffer.from(hkdfSync('sha256', env().JWT_ACCESS_SECRET, 'sat-outbox-salt', 'outbox-payload-v1', 32));
}

export function seal(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    data.toString('base64url'),
  ].join('.');
}

export function unseal(sealed: string): string {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported sealed payload');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
