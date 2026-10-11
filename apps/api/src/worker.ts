import { env } from './config/env';
import { connectDatabase, disconnectDatabase } from './db/connection';
import { defaultJobs, JobRunner } from './jobs/runner';
import { logger } from './lib/logger';

/** Standalone background worker (production runs this as its own process/container). */
async function main(): Promise<void> {
  env();
  await connectDatabase();
  const runner = new JobRunner(defaultJobs());
  runner.start();
  const shutdown = async (signal: string) => {
    logger().info({ signal }, 'worker shutting down');
    await runner.stop();
    await disconnectDatabase();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  process.stderr.write(`Worker startup failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
