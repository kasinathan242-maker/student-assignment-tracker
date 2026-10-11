/* eslint-disable no-console */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * Starts a persistent single-node MongoDB replica set for local development without Docker. A replica set
 * is required because the API uses multi-document transactions. Data lives in .data/mongo at the repo root.
 *   npm run db:local   →   MONGO_URI=mongodb://127.0.0.1:27018/sat?replicaSet=rs0
 */
async function main() {
  const dbPath = path.resolve(process.cwd(), '../../.data/mongo');
  mkdirSync(dbPath, { recursive: true });
  const port = Number(process.env.LOCAL_MONGO_PORT ?? 27018);
  const replSet = await MongoMemoryReplSet.create({
    replSet: { name: 'rs0', count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ port, dbPath }],
  });
  await replSet.waitUntilRunning();
  console.log(
    `\nMongoDB replica set running.\n  MONGO_URI=mongodb://127.0.0.1:${port}/sat?replicaSet=rs0\n  data: ${dbPath}\nPress Ctrl+C to stop.\n`,
  );
  const stop = async () => {
    await replSet.stop({ doCleanup: false });
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
