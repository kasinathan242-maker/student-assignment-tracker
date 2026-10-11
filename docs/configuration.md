# Configuration reference

All settings are environment variables validated at start-up by `apps/api/src/config/env.ts`. Empty values (`KEY=`) count as unset. In production (`NODE_ENV=production`) the API refuses to start if a required value is missing or unsafe; it never falls back to insecure defaults.

| Variable                                                                                                   | Default                      | Notes                                                                                               |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                                                                 | `development`                | `development`, `test` or `production`                                                               |
| `PORT`                                                                                                     | `4000`                       | API port                                                                                            |
| `APP_URL`                                                                                                  | `http://localhost:5173`      | Public web URL; used in email links and as the default CORS origin                                  |
| `CORS_ORIGINS`                                                                                             | `APP_URL`                    | Comma-separated extra origins                                                                       |
| `TRUST_PROXY`                                                                                              | `loopback`                   | Hop count or Express trust value; set to `1` behind one reverse proxy so rate limits see client IPs |
| `LOG_LEVEL`                                                                                                | `debug` (dev), `info` (prod) | Pino level                                                                                          |
| `MONGO_URI`                                                                                                | **required**                 | Must point at a replica set (transactions)                                                          |
| `MONGO_AUTO_INDEX`                                                                                         | `true`                       | Builds indexes on start; disable on very large deployments and run index builds deliberately        |
| `JWT_ACCESS_SECRET`                                                                                        | dev placeholder              | **Required in production**, at least 32 characters                                                  |
| `CSRF_SECRET`                                                                                              | dev placeholder              | **Required in production**, at least 32 characters, different from the JWT secret                   |
| `ACCESS_TOKEN_TTL_MINUTES`                                                                                 | `15`                         | Access cookie lifetime                                                                              |
| `REFRESH_TOKEN_TTL_DAYS`                                                                                   | `30`                         | Refresh session lifetime                                                                            |
| `COOKIE_SECURE`                                                                                            | `false`                      | **Must be `true` in production**                                                                    |
| `LOGIN_LOCKOUT_THRESHOLD` / `LOGIN_LOCKOUT_MINUTES`                                                        | `10` / `15`                  | Account lockout policy                                                                              |
| `REDIS_URL`                                                                                                | unset                        | Shares rate-limit counters across API instances (required when running more than one)               |
| `RATE_LIMIT_ENABLED`                                                                                       | `true`                       | Disable only in tests                                                                               |
| `EMAIL_PROVIDER`                                                                                           | `file`                       | `smtp` (required in production), `file` (writes to `DEV_MAILBOX_DIR`), `memory` (tests)             |
| `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`                            |                              | SMTP delivery (works with any transactional provider's SMTP endpoint)                               |
| `DEV_MAILBOX_DIR`, `DEV_MAILBOX_ENABLED`                                                                   | `.data/mail`, `false`        | Development mailbox endpoint; forbidden in production                                               |
| `REQUIRE_EMAIL_VERIFICATION`                                                                               | `false`                      | `true` makes new accounts confirm their email before signing in or using a join code                |
| `STORAGE_PROVIDER`                                                                                         | `local`                      | `local` or `s3`                                                                                     |
| `LOCAL_STORAGE_DIR`                                                                                        | `.data/uploads`              | Local object storage root                                                                           |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` |                              | S3-compatible storage. Omit keys to use the AWS default credential chain (IAM role)                 |
| `S3_CREATE_BUCKET`                                                                                         | `false`                      | Create the bucket on first use (local stacks only)                                                  |
| `S3_SSE`                                                                                                   | `AES256`                     | `AES256`, `aws:kms` or `none` for gateways without server-side encryption                           |
| `MALWARE_SCANNER`                                                                                          | `none`                       | `clamav` to scan uploads via clamd                                                                  |
| `CLAMAV_HOST`, `CLAMAV_PORT`                                                                               | `127.0.0.1`, `3310`          |                                                                                                     |
| `REQUIRE_CLEAN_SCAN`                                                                                       | `false`                      | Block downloads until a file is scanned clean (recommended with ClamAV)                             |
| `RUN_WORKER_INLINE`                                                                                        | `true`                       | Run background jobs in the API process; set `false` in production and run the worker separately     |
| `WORKER_POLL_MS`                                                                                           | `5000`                       | Outbox polling interval                                                                             |
| `SCHEDULER_INTERVAL_MS`                                                                                    | `30000`                      | Interval for publication, auto-close, announcement and reminder jobs                                |
| `ERROR_REPORTER`, `ERROR_WEBHOOK_URL`                                                                      | `log`                        | `webhook` POSTs sanitized error events (no bodies, cookies or headers)                              |
| `WEB_DIST_DIR`                                                                                             | unset                        | Built web app to serve from the API on one port (set automatically by `npm start`)                  |
| `APP_VERSION`                                                                                              | `1.0.0`                      | Reported by health endpoints                                                                        |

Organization-level settings (self-registration mode, allowed email domains, whether teachers may create courses, CSV import, default reminder offsets, retention periods) are managed in the app under **Organization settings**.

Generate secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```
