# Architecture

## Overview

```
Browser (React SPA) ──HTTP(S)──▶ API process (serves the built SPA and /api/v1)
                                   │
                                   ▼
                          API (Express, /api/v1) ──▶ MongoDB replica set
                                   │                  ▲
                   S3 storage ◀────┤                  │ outbox events, schedules
                   ClamAV  ◀───────┤                  │
                   Redis (limits) ◀┘          Worker process ──▶ SMTP
```

- The SPA and API are served from the **same origin** (the API serves the built web app with `npm start`; the Vite proxy does the same in development), so authentication cookies are first-party and CORS is not needed for the app itself.
- The **worker** is the same code base (`dist/worker.js`). It drains the transactional outbox (notifications, email) and runs time-based jobs: scheduled publication, auto-close, deadline reminders, invitation expiry, orphaned-upload cleanup and scan retries. In development it runs inside the API process (`RUN_WORKER_INLINE=true`).

## API structure (`apps/api/src`)

| Folder               | Responsibility                                                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config/env.ts`      | Validated configuration; fails fast in production on missing or unsafe settings                                                                                                                          |
| `lib/route.ts`       | Declarative route helper: auth, tenant context, role gate, Zod validation, OpenAPI registration                                                                                                          |
| `middleware/`        | Request id and receipt time, CSRF, authentication, tenant context, rate limits, idempotency, errors                                                                                                      |
| `services/access.ts` | **All authorization decisions** for course, assignment and submission resources                                                                                                                          |
| `services/`          | Sessions and tokens, passwords, audit, outbox, notifications, email, storage, scanning, files                                                                                                            |
| `modules/<domain>/`  | Route handlers and domain services per area (auth, me, orgs, courses, assignments, submissions, grading, extensions, announcements, notifications, calendar, dashboards, audit, platform, files, health) |
| `models/`            | Mongoose schemas with explicit fields, limits and indexes                                                                                                                                                |
| `jobs/`              | Outbox handlers, scheduled jobs and the job runner                                                                                                                                                       |
| `scripts/`           | Local MongoDB, seed, bootstrap admin, OpenAPI export, perf, storage reconciliation                                                                                                                       |

## Key design decisions

1. **Tenant isolation at the API.** Every organization-scoped route lives under `/orgs/:orgId` and passes `orgContext`, which requires an _active_ membership and returns 404 for anything else. Services always filter by `orgId`. Course-level access (`services/access.ts`) additionally requires an enrollment or administrator role. Hiding navigation in the UI is never relied on.
2. **Shared domain rules.** Deadlines, the submission state machine, the assignment lifecycle, grade validation and late penalties live in `packages/shared/src/domain` as pure functions. The API enforces them; the UI uses the same functions only to explain outcomes.
3. **Server time is authoritative.** Each request records `req.receivedAt`; submission timing uses that instant (see [domain-rules.md](domain-rules.md)).
4. **Durable side effects.** State changes and the events they cause (notify students, send email) are written in one MongoDB transaction via the outbox. Delivery is at-least-once with exponential backoff and dead-lettering; every handler is idempotent through unique notification dedupe keys.
5. **Optimistic concurrency.** Assignments, submissions, grades, rubrics and announcements carry a `rev` counter that every update must match (`409 stale_revision` otherwise).
6. **Idempotent submission.** The final-submit endpoint honours an `Idempotency-Key`; retries after a network failure replay the original receipt instead of creating a second version.
7. **Files are private objects.** Content lives in object storage under generated keys; MongoDB stores metadata. Downloads go through an authenticated proxy that re-checks permissions every time.

## Why no BullMQ

The brief suggested BullMQ for background work. A MongoDB-backed outbox was chosen instead: it gives transactional enqueueing (an event is committed atomically with the change that caused it, which BullMQ cannot do without its own outbox) and keeps Redis optional for local development and small deployments. Redis is still supported for shared rate-limit counters across API instances. The job interfaces (`registerOutboxHandler`, `JobRunner`) are small, so moving to BullMQ later only affects `services/outbox.ts` and `jobs/runner.ts`.

## Web structure (`apps/web/src`)

- `app/`: router (route-level code splitting), session handling, organization context, guards, theme.
- `lib/api.ts`: Axios client with CSRF header, single-flight refresh on 401 and normalized `ApiError`.
- `components/ui/`: accessible primitives (Radix dialogs and menus, form fields with wired labels, hints and errors).
- `features/<area>/`: pages per area. Server state lives only in TanStack Query; there is no client-side copy of business data and no mock data.

## Data model

Collections (all organization-owned documents carry `orgId`): `users`, `refreshSessions`, `emailTokens`, `organizations`, `memberships`, `invitations`, `departments`, `courses`, `courseSections`, `enrollments`, `assignments`, `assignmentChanges`, `rubrics`, `files`, `submissions` (one per student per assignment, unique index), `submissionVersions` (immutable attempts), `gradingRecords` (draft and published grade content with rubric snapshots), `gradeHistory`, `extensionRequests`, `notifications`, `announcementRecords`, `announcementReceipts`, `auditLogs`, `idempotencyRecords`, `outboxEvents`, `workerHeartbeats`, `loginAttempts`. Indexes are declared next to each schema in `apps/api/src/models`; TTL indexes implement retention for sessions, tokens, notifications, audit records, idempotency records and completed outbox events.

Records with dependants are archived, never hard-deleted (courses, assignments, rubrics, departments, memberships). Files are soft-deleted and their objects removed only when nothing references them.
