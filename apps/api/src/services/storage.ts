import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { env } from '../config/env';

/**
 * Object storage abstraction. Keys are always generated server-side (see files.ts) and validated here,
 * so client-supplied names or paths can never select a storage location. Objects are private: content is
 * only reachable through the authenticated download endpoint.
 */
export interface ObjectStorage {
  readonly name: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  healthCheck(): Promise<boolean>;
}

const KEY_PATTERN = /^[a-z0-9][a-z0-9/_-]{8,200}$/;

export function assertSafeKey(key: string): void {
  if (!KEY_PATTERN.test(key) || key.includes('..') || key.includes('//')) {
    throw new Error('Invalid storage key');
  }
}

export class LocalStorage implements ObjectStorage {
  readonly name = 'local';
  private readonly root: string;
  constructor(root = env().LOCAL_STORAGE_DIR) {
    this.root = path.resolve(root);
  }
  private resolve(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error('Invalid storage key');
    return full;
  }
  async put(key: string, body: Buffer): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body, { flag: 'wx' });
  }
  async get(key: string): Promise<Readable> {
    const full = this.resolve(key);
    await stat(full); // throws ENOENT before streaming starts
    return createReadStream(full);
  }
  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
  async healthCheck(): Promise<boolean> {
    try {
      await mkdir(this.root, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }
}

export class S3Storage implements ObjectStorage {
  readonly name = 's3';
  private readonly client: S3Client;
  private readonly bucket: string;
  constructor() {
    const config = env();
    this.bucket = config.S3_BUCKET as string;
    this.client = new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials:
        config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY }
          : undefined,
    });
  }
  private bucketReady: Promise<void> | null = null;
  /** Creates the bucket once when S3_CREATE_BUCKET=true (local stacks); otherwise a no-op. */
  private ensureBucket(): Promise<void> {
    if (!env().S3_CREATE_BUCKET) return Promise.resolve();
    this.bucketReady ??= this.client
      .send(new HeadBucketCommand({ Bucket: this.bucket }))
      .then(() => undefined)
      .catch(() => this.client.send(new CreateBucketCommand({ Bucket: this.bucket })).then(() => undefined))
      .catch((err: unknown) => {
        this.bucketReady = null;
        throw err;
      });
    return this.bucketReady;
  }
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    await this.ensureBucket();
    const sse = env().S3_SSE;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentDisposition: 'attachment',
        ...(sse === 'none' ? {} : { ServerSideEncryption: sse }),
      }),
    );
  }
  async get(key: string): Promise<Readable> {
    assertSafeKey(key);
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return out.Body as Readable;
  }
  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  async exists(key: string): Promise<boolean> {
    try {
      const stream = await this.get(key);
      stream.destroy();
      return true;
    } catch {
      return false;
    }
  }
  async healthCheck(): Promise<boolean> {
    try {
      await this.ensureBucket();
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }
}

let instance: ObjectStorage | null = null;

export function storage(): ObjectStorage {
  instance ??= env().STORAGE_PROVIDER === 's3' ? new S3Storage() : new LocalStorage();
  return instance;
}

export function setStorage(next: ObjectStorage | null): void {
  instance = next;
}
