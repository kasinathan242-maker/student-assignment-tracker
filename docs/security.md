# Security model

## Authentication

- Passwords: Argon2id (19 MiB, 2 iterations), NFC-normalized, minimum 12 characters, common-password and email checks, maximum length enforced.
- Sessions: a 15-minute JWT access cookie (`HttpOnly`, `SameSite=Lax`, `Secure` in production, path `/api`) plus a rotating opaque refresh token (`SameSite=Strict`, path `/api/v1/auth`) stored as a SHA-256 hash. Every request also checks that the session is still active, so logout, password changes, suspensions and role changes take effect immediately.
- **Replay detection:** presenting an already-rotated refresh token revokes the whole session and is audited.
- **No account enumeration:** public registration, forgot-password and resend-verification always return the same response; login uses one error message and spends equal hashing time for unknown accounts. Account status is revealed only after the correct password.
- Brute force: per-IP and per-IP+email rate limits plus account lockout (10 failures → 15 minutes), all configurable.
- Email verification is optional (`REQUIRE_EMAIL_VERIFICATION`, off by default because a single-machine install does not deliver real email). When it is off, registering an email that already has an account never changes that account, and invitations addressed to an email are only offered to accounts that have proven they own it. When it is on, sign-in requires a confirmed email, and the verification link only works together with the account password, so an address registered by someone else cannot be claimed by clicking the link (pre-account takeover). Invitation sign-up proves inbox ownership through the token in either mode.
- One-time tokens (verification, reset, invitation) are 256-bit random values stored as hashes, single use and short-lived. Links carry them in the URL **fragment** (`#token=`), which never reaches server logs, and the app removes it from the address bar. Email payloads containing tokens are encrypted (AES-256-GCM) in the outbox and scrubbed after delivery.

## CSRF

All state-changing requests require the `x-csrf-token` header matching an HMAC-signed double-submit cookie. Combined with `SameSite` cookies and an allowlist CORS policy, cross-site requests cannot act on a user's session.

## Authorization

- Default deny. Organization routes require an active membership (404 otherwise, so other tenants are not revealed). Course, assignment and submission access is decided centrally in `apps/api/src/services/access.ts`.
- Roles: `student`, `teacher`, `org_admin` per organization; `platform_admin` is separate, cannot be self-assigned, and is granted only by another platform admin (with a reason) or the bootstrap CLI. It gives no access to academic data inside organizations.
- Teachers manage only courses they instruct and can invite only students. Instructor enrollment requires a staff membership. Members cannot change their own role or status, and the last administrator cannot be removed.
- Administrators do not see submissions or grades by default. The break-glass endpoint (`/orgs/:orgId/admin/submissions/:id?reason=…`) and file downloads with a reason are audited and counted on the admin dashboard.
- Bulk operations are constrained to the target assignment; ids from elsewhere are ignored.

## Input handling

- Every body, query and path parameter is validated with strict Zod schemas (unknown keys rejected). Mass assignment of fields such as `role` or `platformRole` returns 400.
- Query strings use the simple parser (no nested objects), sort fields are allowlisted, and search text is regex-escaped, so MongoDB operator injection is not possible.
- JSON bodies are capped at 1.5 MB; uploads are capped per assignment (maximum 100 MB) and per avatar (2 MB).
- Markdown (instructions, announcements) is rendered without raw HTML; links open with `noopener noreferrer`.
- CSV exports neutralize spreadsheet formulas. CSV imports are previewed, bound to a content hash, and refuse files with errors.
- Redirect targets after sign-in accept only same-origin paths.

## Files

Uploads are checked against extension allowlists and **magic bytes** (content must match the extension; text formats must be valid UTF-8). The server chooses the MIME type and storage key, sanitizes display names, scans with ClamAV when configured, and never serves files inline (except avatars that are raster images): downloads use `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` and a sandbox CSP. HTML and SVG uploads are never accepted. With `REQUIRE_CLEAN_SCAN=true`, files without a clean scan cannot be downloaded.

## Transport and headers

Helmet on the API (CSP `default-src 'none'`, HSTS in production, no referrer, same-origin resource policy), a strict CSP and security headers on the web app pages (`apps/api/src/web.ts`), `Cache-Control: no-store` with `Vary: Cookie` on all API responses, and cache-clearing on logout and session expiry in the SPA.

## Logging and auditing

Logs are structured JSON with request ids; cookies, authorization headers, CSRF and idempotency headers, passwords, tokens and free-text bodies are redacted, and request bodies are not logged. Audit records cover authentication events, membership and role changes, course, assignment and grade changes, exports, break-glass access and platform actions, with secrets stripped from metadata. Client errors never include stack traces.

## Secrets

Secrets come only from the environment. Production refuses to start without `JWT_ACCESS_SECRET` and `CSRF_SECRET` (different values), with `COOKIE_SECURE=false`, a non-SMTP email provider or the development mailbox enabled. There are no default production accounts: the first platform administrator is created explicitly with `npm run bootstrap:platform-admin`. The seed script refuses to run in production.

## Verified by tests

`apps/api/test/security.test.ts`, `auth.test.ts`, `admin.test.ts` and the E2E suite cover: anonymous rejection, cross-tenant 404s, student and teacher isolation, self-promotion attempts, client-side role spoofing, break-glass auditing, operator injection, sensitive-field exposure, error sanitization, payload limits, security headers, CORS, CSRF, refresh replay, logout and expiry, lockout, enumeration resistance, upload spoofing and path traversal, and download authorization.
