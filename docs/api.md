# API

Base path: `/api/v1`. The complete, generated reference is [openapi.json](openapi.json) (also served at `/api/v1/openapi.json`); regenerate it with `npm run openapi`. CI fails if it is out of date.

## Conventions

- **Authentication:** HttpOnly cookies set by `POST /auth/login`. On `401 token_expired`, call `POST /auth/refresh` once and retry (the web client does this automatically, one refresh at a time).
- **CSRF:** every `POST/PUT/PATCH/DELETE` needs `x-csrf-token`, obtained from `GET /auth/csrf` or `GET /me` (`csrfToken`).
- **Tenancy:** organization data lives under `/orgs/:orgId/...`. Non-members get `404`.
- **Pagination:** `?page=1&pageSize=25` (max 100) → `{ items, page, pageSize, total, totalPages }`. Sorting uses allowlisted `sort=field` or `sort=-field`.
- **Concurrency:** mutable resources return `rev`; send it back as `expectedRev`. A mismatch returns `409 stale_revision`.
- **Idempotency:** `POST …/my-submission/submit` accepts an `Idempotency-Key` header (8–128 characters). Retries replay the original response with `Idempotent-Replayed: true`.
- **Dates:** ISO-8601 instants with an offset; responses are UTC.

## Errors

```json
{
  "error": {
    "code": "stale_revision",
    "message": "This item was changed by someone else…",
    "requestId": "…",
    "fields": { "dueAt": ["Must be in the future"] }
  }
}
```

| Status | Category                 | Example codes                                                                                   |
| ------ | ------------------------ | ----------------------------------------------------------------------------------------------- |
| 400    | validation               | `validation_failed`, `invalid_token`, `file_content_mismatch`, `reason_required`                |
| 401    | authentication           | `unauthenticated`, `token_expired`, `session_revoked`, `invalid_credentials`                    |
| 403    | authorization            | `forbidden`, `csrf_invalid`, `email_not_verified`, `org_suspended`                              |
| 404    | not found (or not yours) | `not_found`                                                                                     |
| 409    | conflict                 | `stale_revision`, `already_submitted`, `attempts_exhausted`, `submissions_closed`, `last_admin` |
| 413    | payload too large        | `payload_too_large`                                                                             |
| 429    | rate limit               | `rate_limited` (with `Retry-After`)                                                             |
| 503    | dependency               | `database_unavailable`, `storage_unavailable`                                                   |

## Endpoint groups

Authentication · current user, sessions, preferences, avatar, export · invitations and join codes · organizations, members, invitations, departments · courses, sections, rosters, CSV import and export · assignments (lifecycle, duplicate, change history, stats, attachments) · student submissions (draft, files, submit, withdraw, versions) · grading (inbox, workspace, grade draft, publish, return, history, bulk publish, release) · rubrics · extensions · announcements · notifications · calendar and `.ics` · dashboards and course reports, gradebook CSV · audit logs and exports · platform administration · files (authorized downloads) · health.
