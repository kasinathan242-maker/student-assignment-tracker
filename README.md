# Student Assignment Tracker

A multi-tenant platform where institutions run courses, teachers publish and grade assignments, and students submit work, track deadlines and receive feedback.

- **Students**: one list of every assignment and deadline, autosaved drafts, submission receipts, resubmissions and extension requests, released grades with rubric feedback, calendar export, personal data export.
- **Teachers**: courses, sections and rosters (including CSV import), a 4-step assignment wizard with scheduling, late and resubmission policies, a submission inbox, a rubric grading workspace, audited grade corrections, held grade release, extension decisions, announcements and course reports.
- **Organization administrators**: members, roles and invitations, departments, organization settings, aggregate dashboards, a searchable and exportable audit log, and audited "break-glass" access to records.
- **Platform administrators**: organization registry, platform roles, account suspension, cross-tenant audit and service health.

## Stack

| Layer           | Technology                                                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Web             | React 19, Vite 8, React Router 8, TanStack Query 5, Tailwind CSS 4, Radix primitives, Phosphor icons, React Hook Form + Zod, Recharts, Luxon |
| API             | Node.js 22+, Express 5, Mongoose 9 (MongoDB replica set), Zod 4, Pino, jose (JWT), Argon2id                                                  |
| Background work | Transactional outbox and scheduler in MongoDB (`apps/api/src/jobs`), run inline or as a separate worker process                              |
| Integrations    | SMTP email, S3-compatible storage, ClamAV scanning, optional Redis for distributed rate limits, error webhook                                |
| Tests           | Vitest (unit and integration with an in-memory replica set), React Testing Library, Playwright + axe-core                                    |

## Repository layout

```
apps/
  api/        REST API (/api/v1), worker, scripts (seed, bootstrap, OpenAPI, perf, storage reconciliation)
  web/        React SPA, component tests, Playwright E2E (e2e/)
packages/
  shared/     Zod schemas, DTO types and pure domain rules shared by both apps
  config/     TypeScript base configs
  eslint-config/
docs/         Architecture, domain rules, security, operations, API (openapi.json) and more
scripts/      Launchers: dev (watch mode) and start (built app on one port)
```

## Quick start (runs entirely on this machine, no Docker)

Requirements: Node.js 22.12+ and npm 10+.

```bash
npm install
cp .env.example .env                 # development defaults; no secrets needed locally
npm run db:local                     # terminal 1: local MongoDB replica set (persistent, in .data/)
npm run seed                         # demo data; prints the shared demo password
npm run dev                          # terminal 2: API on :4000 (with worker) + web on :5173
```

Open http://localhost:5173/login and choose the **Student**, **Teacher** or **HOD / Admin** login (each admits only accounts with that role), then sign in with a seeded account (`kavya@northfield.test` for a student, `priya@northfield.test` for a teacher, `admin@northfield.test` for the HOD / Admin login, `platform@demo.test` for the platform administrator, also through the HOD / Admin login). Set `SEED_PASSWORD` before seeding to choose the password. Emails such as invitations and password resets appear at http://localhost:5173/dev/mail.

To run the optimised build instead of watch mode, keep `npm run db:local` running and use `npm run build` then `npm start`: the API serves the web app, the worker runs inline, and everything is on http://localhost:4000. See [docs/deployment.md](docs/deployment.md).

## Common commands

| Command                                                       | What it does                                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `npm run dev`                                                 | API and web in watch mode                                                        |
| `npm run build` then `npm start`                              | Production build served by one process on http://localhost:4000                  |
| `npm run verify`                                              | Format check, lint, typecheck, all unit and integration tests, production builds |
| `npm test`                                                    | Shared, API (integration, in-memory MongoDB) and web test suites                 |
| `npm run test:e2e`                                            | Playwright journey and accessibility suite (starts its own isolated stack)       |
| `npm run openapi`                                             | Regenerate `docs/openapi.json` from the route definitions                        |
| `npm run perf -w @sat/api`                                    | Performance measurement against a 27k-submission dataset                         |
| `npm run bootstrap:platform-admin -- --email you@example.org` | Create or promote the first platform administrator                               |

## Verification status

All of the following were run and passed on the final code:

- Lint (ESLint, zero warnings), Prettier, TypeScript in every workspace, production builds of both apps.
- 34 shared domain unit tests, 100 API tests (unit and HTTP integration against a real MongoDB replica set, including authorization, tenant isolation, injection and worker reliability), 24 web unit and component tests.
- 22 Playwright tests: the 20 required end-to-end scenarios across all roles, plus axe WCAG 2.2 AA scans of 12 screens (public pages in light and dark themes).
- Performance budgets: every measured operation p95 under 90 ms locally (see [docs/performance.md](docs/performance.md)).
- `npm audit --omit=dev`: 0 vulnerabilities.

## Documentation

- [Architecture](docs/architecture.md) and [domain rules](docs/domain-rules.md) (deadlines, submission states, grading)
- [Security model](docs/security.md)
- [Configuration reference](docs/configuration.md) and [development guide](docs/development.md)
- [Deployment](docs/deployment.md) and [operations runbooks](docs/operations.md)
- [API](docs/api.md) ([OpenAPI document](docs/openapi.json)), [metrics definitions](docs/metrics.md)
- [Testing](docs/testing.md), [performance](docs/performance.md), [accessibility](docs/accessibility.md), [design system](docs/design.md)

## What needs external credentials

Nothing is required for local development. Production needs: an SMTP provider, an S3-compatible bucket, a MongoDB replica set, TLS at the edge, and generated `JWT_ACCESS_SECRET` / `CSRF_SECRET`. ClamAV, Redis and an error-reporting webhook are optional and documented in [docs/configuration.md](docs/configuration.md).

## License

MIT
