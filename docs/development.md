# Development guide

## Prerequisites

- Node.js 22.12 or newer (developed on 26.x) and npm 10+.
- Nothing else: no Docker, no cloud account. MongoDB runs from a local binary that npm downloads.

## First run

```bash
npm install
cp .env.example .env
npm run db:local        # leave running; prints MONGO_URI (already set in .env.example)
npm run seed            # optional demo data (SEED_PASSWORD=... to choose the password; --reset to recreate)
npm run dev             # API :4000 + web :5173
```

`npm run db:local` starts a persistent single-node **replica set** using the `mongodb-memory-server` binary (data in `.data/mongo`). A replica set is required because the API uses multi-document transactions. Any other MongoDB replica set works too: set `MONGO_URI` to it.

Development defaults: email is written to `.data/mail` and visible at http://localhost:5173/dev/mail; uploads go to `.data/uploads`; the worker runs inside the API process.

## Working on the code

- Shared validation and domain rules go in `packages/shared` (consumed as TypeScript source by both apps).
- New API endpoints are declared with `route()` in a module's `routes.ts`. Pick the access level (`public`, `user`, `org`, `platform`), pass Zod schemas for params, query and body, and put authorization in `services/access.ts` style helpers. The OpenAPI document updates automatically (`npm run openapi`).
- Pages live in `apps/web/src/features/<area>` and are registered in `app/router.tsx`. Use the components in `components/ui`. Fetch with TanStack Query through `lib/api.ts`; never keep business data in local state or `localStorage`.

## Quality checks

```bash
npm run verify          # format check, lint, typecheck, unit + integration tests, builds
npm run test:e2e        # Playwright (downloads Chromium once: npx playwright install chromium -w @sat/web)
```

API integration tests start an in-memory replica set automatically; each test file uses its own database.

## Creating the first platform administrator

```bash
BOOTSTRAP_PASSWORD='a long unique passphrase' npm run bootstrap:platform-admin -- --email ops@example.org --name "Operations"
```

The platform administrator creates organizations; each organization's first administrator is invited by email.
