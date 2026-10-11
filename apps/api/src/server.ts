import type { Server } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { connectDatabase, disconnectDatabase } from './db/connection';
import { defaultJobs, JobRunner } from './jobs/runner';
import { logger } from './lib/logger';
import { closeRedis } from './middleware/rateLimit';

async function main(): Promise<void> {
  const config = env(); // fails fast on invalid configuration
  await connectDatabase();
  const app = createApp();
  // Express 5 calls the listen callback with an error (e.g. EADDRINUSE) instead of throwing, so wait for
  // the outcome: otherwise a second copy logs "listening" and runs jobs while serving nothing.
  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(config.PORT, (err?: Error) => (err ? reject(err) : resolve(s)));
  }).catch(async (err: NodeJS.ErrnoException) => {
    await disconnectDatabase();
    throw err.code === 'EADDRINUSE'
      ? new Error(
          `Port ${config.PORT} is already in use. Another copy of the app may be running: stop it, or set PORT in .env.`,
        )
      : err;
  });
  logger().info({ port: config.PORT, env: config.NODE_ENV }, 'API listening');
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 120_000;

  const runner = config.RUN_WORKER_INLINE ? new JobRunner(defaultJobs()) : null;
  runner?.start();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger().info({ signal }, 'shutting down');
    server.close();
    await runner?.stop();
    await closeRedis();
    await disconnectDatabase();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  // Logger may not be configurable if the environment itself is invalid.
  process.stderr.write(`Startup failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
