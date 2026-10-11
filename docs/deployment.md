# Running the app

The project runs directly on your machine with Node.js. There are no containers.

## Components

| Component     | How it runs                                                       | Notes                                          |
| ------------- | ----------------------------------------------------------------- | ---------------------------------------------- |
| Web app       | Built to `apps/web/dist`, served by the API (`npm start`)         | Vite serves it in development (`npm run dev`)  |
| API           | `node apps/api/dist/server.js` (port 4000)                        | Runs the background worker inline by default   |
| Worker        | Inline, or separately with `npm run start:worker -w @sat/api`     | All jobs are safe to run concurrently          |
| MongoDB       | `npm run db:local` (local replica set in `.data/mongo`), or Atlas | Must be a replica set (transactions)           |
| File storage  | `.data/uploads` (local), or any S3-compatible bucket              |                                                |
| Email         | `.data/mail`, readable at `/dev/mail`, or any SMTP provider       |                                                |
| Redis, ClamAV | Optional                                                          | Distributed rate limits, upload virus scanning |

## Built app on one port

```bash
npm run db:local        # terminal 1, leave running
npm run build
npm start               # terminal 2: http://localhost:4000
```

`npm start` (`scripts/start.mjs`) loads `.env`, points the API at the built web app (`WEB_DIST_DIR`), and switches `APP_URL` to port 4000 when it still points at the Vite dev port, so email links work. The API sets the web app's security headers (strict CSP, no framing, `nosniff`, no referrer) and caches fingerprinted assets for a year.

Create the first platform administrator (instead of seeding demo data):

```bash
BOOTSTRAP_PASSWORD='a long unique passphrase' npm run bootstrap:platform-admin -- --email you@example.org
```

## Exposing it beyond this machine

If you later put the app on a server, use HTTPS in front of it (any reverse proxy) and set:

- [ ] `NODE_ENV=production`, `COOKIE_SECURE=true`, strong distinct `JWT_ACCESS_SECRET` and `CSRF_SECRET`
- [ ] `APP_URL` to the public HTTPS address and `TRUST_PROXY=1`
- [ ] `EMAIL_PROVIDER=smtp` with SMTP settings, and `DEV_MAILBOX_ENABLED=false`
- [ ] MongoDB backups; S3 storage (`STORAGE_PROVIDER=s3`) if more than one server stores files
- [ ] `RUN_WORKER_INLINE=false` with a separate worker process, and `REDIS_URL` if more than one API instance
- [ ] Monitor `/api/v1/health/ready` and `/api/v1/health/live`; see [operations.md](operations.md)

The API refuses to start in production mode if any required secret or safe setting is missing.

## Updating and rolling back

Database changes in this code base are additive (new fields have defaults and indexes are created automatically), so the previous release can run against the new schema. To roll back, check out the previous release, run `npm ci && npm run build`, and restart.
