#!/usr/bin/env node
/**
 * One-command local development: starts the API (with the background worker inline) and the web app.
 * Requires MONGO_URI in .env pointing at a replica set — run `npm run db:local` first. See docs/development.md.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

if (!existsSync('.env')) {
  console.error(
    'Missing .env. Copy .env.example to .env and adjust it (the defaults work for local development).',
  );
  process.exit(1);
}
const env = readFileSync('.env', 'utf8');
if (!/^MONGO_URI=.+/m.test(env)) {
  console.error(
    'MONGO_URI is not set in .env. Start a database with `npm run db:local` and paste the printed URI.',
  );
  process.exit(1);
}

// Run npm's own CLI with this Node binary when launched through `npm run`: no shell is needed (avoids
// DEP0190 on Windows) and the child PID is the real npm process, so stopping it stops the server.
const npmCli = process.env.npm_execpath;
const viaNode = Boolean(npmCli && /.c?js$/.test(npmCli));
const npm = viaNode ? [process.execPath, [npmCli]] : [process.platform === 'win32' ? 'npm.cmd' : 'npm', []];

/** On Windows, killing a process does not kill its children (npm → node → vite), which would keep the ports busy. */
function stop(child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32')
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

const children = [
  ['api', ['run', 'dev', '-w', '@sat/api']],
  ['web', ['run', 'dev', '-w', '@sat/web']],
].map(([name, args]) => {
  const child = spawn(npm[0], [...npm[1], ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: !viaNode && process.platform === 'win32',
  });
  const prefix = (line) => `[${name}] ${line}`;
  for (const stream of [child.stdout, child.stderr]) {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) console.log(prefix(line));
    });
  }
  child.on('exit', (code) => {
    console.log(prefix(`exited with code ${code}`));
    shutdown(code ?? 0);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) stop(child);
  setTimeout(() => process.exit(code), 1000);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
console.log('Starting API on http://localhost:4000 and web app on http://localhost:5173 …');
