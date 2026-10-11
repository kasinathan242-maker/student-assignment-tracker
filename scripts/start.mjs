#!/usr/bin/env node
/**
 * Runs the built app as one process on one port: the API serves the web app, and the background worker runs
 * inline. Build first with `npm run build`. Uses the same .env as development (relative paths in it resolve
 * from apps/api, exactly as in `npm run dev`).
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const apiDir = fileURLToPath(new URL('../apps/api/', import.meta.url));
const webDist = fileURLToPath(new URL('../apps/web/dist/', import.meta.url));
const server = new URL('../apps/api/dist/server.js', import.meta.url);

if (!existsSync(fileURLToPath(server)) || !existsSync(`${webDist}index.html`)) {
  console.error('The app is not built yet. Run `npm run build`, then `npm start`.');
  process.exit(1);
}
try {
  process.loadEnvFile(`${root}.env`);
} catch {
  console.error('Missing .env. Copy .env.example to .env (the defaults work on this machine).');
  process.exit(1);
}

process.env.WEB_DIST_DIR = webDist;
const port = process.env.PORT || '4000';
// The web app is now served by the API itself, so email links and CORS must point at the API's port.
if (!process.env.APP_URL || /:5173\/?$/.test(process.env.APP_URL)) {
  process.env.APP_URL = `http://localhost:${port}`;
}
process.chdir(apiDir);
console.log(`Starting on http://localhost:${port}`);
await import(server.href);
