import { hash, verify } from '@node-rs/argon2';
import { normalizePassword } from '@sat/shared';
import { env } from '../config/env';

/**
 * Argon2id with OWASP-recommended parameters (19 MiB memory, 2 iterations, 1 lane).
 * The test environment uses lighter parameters purely for speed; the algorithm is identical.
 */
/** `Algorithm.Argon2id` from @node-rs/argon2 (an ambient const enum, so referenced by value). */
const ARGON2ID = 2;

function params() {
  return env().isTest
    ? { algorithm: ARGON2ID, memoryCost: 1024, timeCost: 1, parallelism: 1 }
    : { algorithm: ARGON2ID, memoryCost: 19_456, timeCost: 2, parallelism: 1 };
}

export async function hashPassword(password: string): Promise<string> {
  return hash(normalizePassword(password), params());
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, normalizePassword(password));
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;

/** Burns comparable CPU time when an account does not exist, so login timing does not reveal accounts. */
export async function verifyDummyPassword(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing-equalisation');
  await verifyPassword(await dummyHash, password);
}
