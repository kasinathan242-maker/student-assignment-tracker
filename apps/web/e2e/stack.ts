/* eslint-disable no-console */
/**
 * Starts an isolated end-to-end stack: an in-memory MongoDB replica set and the real API with its
 * background worker running inline. No external services are needed: email goes to the in-memory
 * provider, exposed through the development mailbox endpoint so tests can follow verification and
 * invitation links exactly as a person would.
 *
 * Only the platform administrator is seeded (that account has no HTTP creation path by design);
 * everything else in the E2E suite is created through the UI.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

export const E2E_API_PORT = 4100;
export const PLATFORM_ADMIN = { email: 'platform@e2e.test', password: 'platform e2e passphrase' };

async function main() {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await replSet.waitUntilRunning();
  const uri = new URL(replSet.getUri());
  uri.pathname = '/sat_e2e';
  Object.assign(process.env, {
    NODE_ENV: 'development',
    PORT: String(E2E_API_PORT),
    APP_URL: 'http://localhost:5174',
    MONGO_URI: uri.toString(),
    EMAIL_PROVIDER: 'memory',
    DEV_MAILBOX_ENABLED: 'true',
    RATE_LIMIT_ENABLED: 'false',
    RUN_WORKER_INLINE: 'true',
    WORKER_POLL_MS: '400',
    SCHEDULER_INTERVAL_MS: '2000',
    LOG_LEVEL: 'warn',
    LOCAL_STORAGE_DIR: mkdtempSync(path.join(tmpdir(), 'sat-e2e-')),
  });

  const { connectDatabase } = await import('../../api/src/db/connection');
  const { User, defaultNotificationPreferences } = await import('../../api/src/models');
  const { hashPassword } = await import('../../api/src/services/passwords');
  await connectDatabase();
  await User.create({
    email: PLATFORM_ADMIN.email,
    name: 'Platform E2E',
    passwordHash: await hashPassword(PLATFORM_ADMIN.password),
    emailVerifiedAt: new Date(),
    platformRole: 'platform_admin',
    notificationPreferences: defaultNotificationPreferences(),
  });
  // The server module connects again (a no-op) and starts listening plus the inline worker.
  await import('../../api/src/server');
  const stop = async () => {
    await replSet.stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
  console.log(`E2E stack ready on port ${E2E_API_PORT}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
