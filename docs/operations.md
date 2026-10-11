# Operations runbooks

## Health and monitoring

- `GET /api/v1/health/live`: process is up (no dependency checks). Use for liveness probes.
- `GET /api/v1/health/ready`: database and storage reachable. Use for readiness and load-balancer checks.
- **Service health** page (platform admins, `/platform/health`): database, storage, Redis, worker heartbeat age, outbox backlog and dead-lettered events. It never exposes hosts or credentials.
- Logs are JSON with `requestId`; clients see the same id in error responses as "Reference".

Recommended alerts:

| Signal                   | Threshold                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| 5xx rate                 | > 1% of requests over 5 minutes                                                                    |
| Readiness failing        | > 1 minute                                                                                         |
| Worker heartbeat         | older than 2 minutes                                                                               |
| Outbox                   | oldest pending > 10 minutes, or any dead-lettered events                                           |
| Authentication anomalies | spike in `auth.login.failed`, `auth.account.locked` or `auth.session.replay_detected` audit events |
| Storage errors           | log messages `object storage write failed` / `stored object missing`                               |
| Database saturation      | connection pool waits, slow queries > 500 ms, replication lag                                      |

## Database restoration

1. Stop the worker, then scale the API to zero (or enable maintenance at the load balancer).
2. Restore the replica set from backup (point-in-time when available).
3. Run `node dist/scripts/reconcileStorage.js` to list metadata whose objects are missing and objects without metadata (add `--fix` to clean up abandoned uploads).
4. Start the API, check readiness, then start the worker. Pending outbox events in the restored data are delivered; notification dedupe keys prevent duplicates for events already processed.

## Storage reconciliation

Run `reconcileStorage` (above) after storage incidents or restores. Orphaned pending uploads older than 24 hours are removed automatically every hour by the worker.

## Worker restart and recovery

The worker can be restarted at any time. Events locked by a crashed worker are reclaimed after 60 seconds; scheduled jobs use conditional updates, so running two workers never double-publishes. Dead-lettered events (`outboxEvents` with `status: "dead"`) can be retried after fixing the cause by setting `status: "pending", attempts: 0, availableAt: now`.

## Secret rotation

- `JWT_ACCESS_SECRET`: rotate and redeploy. Existing access tokens become invalid; clients refresh automatically using their refresh session, so users stay signed in.
- `CSRF_SECRET`: rotate and redeploy. The SPA fetches a new token on the next 403 `csrf_invalid` and retries once.
- SMTP and S3 credentials: update the secret manager, redeploy API and worker.
- Note: the outbox encrypts email payloads with a key derived from `JWT_ACCESS_SECRET`; drain the outbox (or accept that pending emails will dead-letter) before rotating.

## Account compromise

1. Platform admin: **Accounts → Suspend** (revokes all sessions immediately), or organization admin: **Members → Sign out everywhere** or **Suspend**.
2. Review the audit log for the account (`actorId` filter) and its recent sessions.
3. Ask the user to reset their password (the reset also revokes sessions), then reactivate.

## Failed deployment rollback

Check out the previous release, run `npm ci && npm run build`, and restart the API and worker. Additive schema changes remain compatible. Check readiness, the worker heartbeat and the error rate afterwards.

## Email provider outage

Submissions and grading are unaffected: email is queued in the outbox and retried with exponential backoff (up to 8 attempts over several hours). In-app notifications are still delivered. After the outage, check for dead-lettered `email.send` events and requeue them if they are still relevant.

## Data export and deletion

- Students download their own data at **Account → Download my data**.
- Administrators export members, rosters, gradebooks and the audit log as CSV (each export is audited).
- Deletion: suspend or deactivate the account at platform level; academic records are retained for institutional purposes per your retention policy. Notification and audit retention periods are organization settings and are enforced by TTL indexes.

## Database migration procedure

1. Prefer additive changes: new optional fields with defaults, new indexes (built automatically when `MONGO_AUTO_INDEX=true`; on large collections build them beforehand with `createIndexes` and deploy with auto-index disabled).
2. For transformations, write an idempotent script under `apps/api/src/scripts/` that processes documents in batches and can be re-run safely; test it against a restored copy of production.
3. Deploy code that reads both shapes, run the script, then deploy code that reads only the new shape.
