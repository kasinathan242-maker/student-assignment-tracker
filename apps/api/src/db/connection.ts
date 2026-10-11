import mongoose, { type ClientSession } from 'mongoose';
import { env } from '../config/env';
import { logger } from '../lib/logger';

mongoose.set('strictQuery', true);
// Never let Mongoose buffer commands while disconnected; fail fast and let the error handler return 503.
mongoose.set('bufferCommands', false);

export async function connectDatabase(uri = env().MONGO_URI): Promise<typeof mongoose> {
  const conn = await mongoose.connect(uri, {
    autoIndex: env().MONGO_AUTO_INDEX,
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 50,
  });
  conn.connection.on('disconnected', () => logger().warn('MongoDB disconnected'));
  conn.connection.on('reconnected', () => logger().info('MongoDB reconnected'));
  conn.connection.on('error', (err: Error) => logger().error({ err }, 'MongoDB connection error'));
  if (env().MONGO_AUTO_INDEX) await mongoose.syncIndexes();
  return conn;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

export function isDatabaseReady(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function pingDatabase(): Promise<boolean> {
  try {
    const db = mongoose.connection.db;
    if (!db) return false;
    await db.admin().ping();
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs `fn` inside a MongoDB transaction (requires a replica set — see docs/development.md). The callback
 * may be retried by the driver on transient transaction errors, so it must only perform database work.
 */
export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(
      async () => {
        result = await fn(session);
      },
      { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
    );
    return result as T;
  } finally {
    await session.endSession();
  }
}

export function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 11000
  );
}
