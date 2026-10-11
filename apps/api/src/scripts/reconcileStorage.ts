/* eslint-disable no-console */
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env';
import { connectDatabase, disconnectDatabase } from '../db/connection';
import { cleanupOrphanFiles } from '../jobs/scheduled';
import { FileObject, type FileObjectDoc } from '../models';
import { storage } from '../services/storage';

/**
 * Storage reconciliation (see docs/runbooks.md → "Storage reconciliation").
 *  1. Metadata rows whose object is missing are reported (and marked deleted with --fix if never submitted).
 *  2. Abandoned pending uploads are cleaned up.
 *  3. For local storage, objects with no metadata row are reported (and removed with --fix).
 */
async function walk(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(path.join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out;
}

async function main() {
  const fix = process.argv.includes('--fix');
  await connectDatabase();
  let missing = 0;
  const cursor = FileObject.find({ status: { $ne: 'deleted' } })
    .lean<FileObjectDoc>()
    .cursor();
  for await (const file of cursor) {
    if (!(await storage().exists(file.storageKey))) {
      missing += 1;
      console.log(
        `MISSING OBJECT  file=${file._id.toString()} status=${file.status} purpose=${file.purpose}`,
      );
      if (fix && file.status === 'pending')
        await FileObject.updateOne({ _id: file._id }, { $set: { status: 'deleted', deletedAt: new Date() } });
    }
  }
  const cleaned = await cleanupOrphanFiles();
  let untracked = 0;
  if (env().STORAGE_PROVIDER === 'local') {
    const root = path.resolve(env().LOCAL_STORAGE_DIR);
    for (const key of await walk(root)) {
      if (!(await FileObject.exists({ storageKey: key }))) {
        untracked += 1;
        const { size } = await stat(path.join(root, key));
        console.log(`UNTRACKED OBJECT key=${key} bytes=${size}`);
        if (fix) await storage().delete(key);
      }
    }
  }
  console.log(
    `\nSummary: ${missing} missing objects, ${cleaned} orphaned uploads removed, ${untracked} untracked objects${fix ? ' (fixed)' : ''}.`,
  );
  await disconnectDatabase();
}

main().catch(async (err: unknown) => {
  console.error(err);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
