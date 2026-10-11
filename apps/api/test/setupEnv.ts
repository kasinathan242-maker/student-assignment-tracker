import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inject } from 'vitest';

// Each test file gets its own database and storage directory, so files can run in parallel.
const uri = new URL(inject('mongoUri'));
uri.pathname = `/sat_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;

Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGO_URI: uri.toString(),
  EMAIL_PROVIDER: 'memory',
  RATE_LIMIT_ENABLED: 'false',
  RUN_WORKER_INLINE: 'false',
  DEV_MAILBOX_ENABLED: 'true',
  // Most auth tests cover the stricter mode; the verification-off behaviour is tested by switching it off.
  REQUIRE_EMAIL_VERIFICATION: 'true',
  APP_URL: 'http://localhost:5173',
  LOCAL_STORAGE_DIR: mkdtempSync(path.join(tmpdir(), 'sat-storage-')),
  JWT_ACCESS_SECRET: 'test-jwt-secret-0123456789abcdef0123456789abcdef',
  CSRF_SECRET: 'test-csrf-secret-0123456789abcdef0123456789abcdef',
});
