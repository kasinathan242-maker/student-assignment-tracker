import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Request, Response } from 'express';
import { fileTypeFromBuffer } from 'file-type';
import multer from 'multer';
import { ALLOWED_UPLOAD_EXTENSIONS, LIMITS, type FilePurpose } from '@sat/shared';
import { env } from '../config/env';
import { sha256Hex } from '../lib/crypto';
import { errors } from '../lib/errors';
import { logger } from '../lib/logger';
import { FileObject, type FileObjectDoc, type Id } from '../models';
import { scanner } from './scanner';
import { storage } from './storage';

/**
 * Upload pipeline: size/count limits (multer) → extension allowlist → content sniffing (magic bytes) must
 * agree with the extension → canonical MIME chosen by the server → SHA-256 → generated storage key →
 * private object storage → malware scan → metadata row in MongoDB (`pending` until attached).
 */

/** Single-file multipart parser held in memory (bounded by the global maximum). */
export function singleUpload(maxBytes = LIMITS.maxFileSizeMb * 1024 * 1024) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 5, fieldSize: 1024, parts: 8 },
  }).single('file');
}

const CANONICAL_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odp: 'application/vnd.oasis.opendocument.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  zip: 'application/zip',
  py: 'text/plain',
  java: 'text/plain',
  c: 'text/plain',
  cpp: 'text/plain',
  h: 'text/plain',
  js: 'text/plain',
  ts: 'text/plain',
  json: 'application/json',
  ipynb: 'application/json',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
};

/** Detected (magic-byte) types acceptable for each claimed extension. `null` = must be plain UTF-8 text. */
const SIGNATURES: Record<string, string[] | null> = {
  pdf: ['pdf'],
  png: ['png'],
  jpg: ['jpg'],
  jpeg: ['jpg'],
  gif: ['gif'],
  webp: ['webp'],
  zip: ['zip'],
  docx: ['docx', 'zip'],
  xlsx: ['xlsx', 'zip'],
  pptx: ['pptx', 'zip'],
  odt: ['odt', 'zip'],
  ods: ['ods', 'zip'],
  odp: ['odp', 'zip'],
  doc: ['cfb', 'doc'],
  xls: ['cfb', 'xls'],
  ppt: ['cfb', 'ppt'],
  rtf: ['rtf'],
  mp3: ['mp3'],
  mp4: ['mp4', 'm4v', 'm4a', 'mov'],
  txt: null,
  md: null,
  csv: null,
  py: null,
  java: null,
  c: null,
  cpp: null,
  h: null,
  js: null,
  ts: null,
  json: null,
  ipynb: null,
};

// eslint-disable-next-line no-control-regex -- matching control characters is the purpose of this pattern
const UNSAFE_FILENAME_CHARS = /[\x00-\x1f\x7f<>:"/\\|?*]/g;

/** Strips directories, control characters and reserved characters; preserves a readable display name. */
export function sanitizeFilename(name: string): string {
  const base = path.basename(name.replace(/\\/g, '/'));
  const cleaned = base
    .normalize('NFC')
    // Control characters and characters reserved on common filesystems become underscores.
    .replace(UNSAFE_FILENAME_CHARS, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 200);
  return cleaned || 'file';
}

function extensionOf(name: string): string {
  const ext = path.extname(name).slice(1).toLowerCase();
  return ext;
}

function isProbablyUtf8Text(buf: Buffer): boolean {
  if (buf.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, Math.min(buf.length, 1024 * 1024)));
    return true;
  } catch {
    return false;
  }
}

export interface UploadPolicy {
  purpose: FilePurpose;
  orgId: Id | string | null;
  ownerId: Id | string;
  allowedExtensions: readonly string[];
  maxBytes: number;
  assignmentId?: Id | string | null;
  attachedTo?: FileObjectDoc['attachedTo'];
}

export async function storeUpload(
  file: Express.Multer.File | undefined,
  policy: UploadPolicy,
): Promise<FileObjectDoc> {
  if (!file) throw errors.validation('Choose a file to upload.', { file: ['Required'] });
  const name = sanitizeFilename(file.originalname);
  const ext = extensionOf(name);
  const globallyAllowed = (ALLOWED_UPLOAD_EXTENSIONS as readonly string[]).includes(ext);
  if (!ext || !globallyAllowed || !policy.allowedExtensions.includes(ext)) {
    throw errors.validation(
      `Files of type ".${ext || '?'}" are not accepted here. Allowed: ${policy.allowedExtensions.join(', ')}.`,
      { file: ['File type not allowed'] },
      'file_type_not_allowed',
    );
  }
  if (file.size === 0) throw errors.validation('The file is empty.', { file: ['Empty file'] }, 'file_empty');
  if (file.size > policy.maxBytes) {
    throw errors.tooLarge(
      `The file is larger than the ${Math.round(policy.maxBytes / 1024 / 1024)} MB limit.`,
    );
  }

  const expected = SIGNATURES[ext];
  const detected = await fileTypeFromBuffer(file.buffer);
  if (expected === null) {
    if (detected || !isProbablyUtf8Text(file.buffer)) {
      throw errors.validation(
        'The file content does not match its extension.',
        { file: ['Content mismatch'] },
        'file_content_mismatch',
      );
    }
  } else if (!detected || !expected?.includes(detected.ext)) {
    throw errors.validation(
      'The file content does not match its extension.',
      { file: ['Content mismatch'] },
      'file_content_mismatch',
    );
  }

  const mimeType = CANONICAL_MIME[ext] ?? 'application/octet-stream';
  const now = new Date();
  const scope = policy.orgId ? policy.orgId.toString() : 'global';
  const storageKey = `${scope}/${policy.purpose.replace('_', '-')}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}`;

  try {
    await storage().put(storageKey, file.buffer, mimeType);
  } catch (err) {
    logger().error({ err }, 'object storage write failed');
    throw errors.dependency(
      'File storage is temporarily unavailable. Please try again.',
      'storage_unavailable',
    );
  }

  const scanStatus = await scanner().scan(file.buffer);
  if (scanStatus === 'infected') {
    await storage()
      .delete(storageKey)
      .catch(() => undefined);
    logger().warn(
      { ownerId: policy.ownerId.toString(), purpose: policy.purpose },
      'infected upload rejected',
    );
    throw errors.validation(
      'This file was flagged by the malware scanner and was not saved.',
      { file: ['Rejected by scanner'] },
      'file_infected',
    );
  }

  try {
    return (
      await FileObject.create({
        orgId: policy.orgId,
        ownerId: policy.ownerId,
        purpose: policy.purpose,
        storageKey,
        originalName: name,
        extension: ext,
        mimeType,
        size: file.size,
        sha256: sha256Hex(file.buffer),
        status: 'pending',
        scanStatus,
        attachedTo: policy.attachedTo ?? null,
        assignmentId: policy.assignmentId ?? null,
      })
    ).toObject() as FileObjectDoc;
  } catch (err) {
    // Compensation: never leave an object without metadata.
    await storage()
      .delete(storageKey)
      .catch(() => undefined);
    throw err;
  }
}

/** Marks a file as deleted and removes the object. Callers must ensure nothing references it. */
export async function deleteStoredFile(file: Pick<FileObjectDoc, '_id' | 'storageKey'>): Promise<void> {
  await FileObject.updateOne({ _id: file._id }, { $set: { status: 'deleted', deletedAt: new Date() } });
  await storage()
    .delete(file.storageKey)
    .catch((err: unknown) =>
      logger().warn({ err, fileId: file._id.toString() }, 'object delete failed; reconciliation will retry'),
    );
}

/** Streams a file with headers that prevent inline rendering/script execution in the browser. */
export async function streamFile(
  req: Request,
  res: Response,
  file: FileObjectDoc,
  opts: { inline?: boolean } = {},
): Promise<void> {
  if (file.scanStatus === 'infected')
    throw errors.forbidden('This file was flagged by the malware scanner.', 'file_infected');
  if (env().REQUIRE_CLEAN_SCAN && file.scanStatus !== 'clean') {
    throw errors.conflict(
      'This file is waiting for a security scan. Try again in a few minutes.',
      'file_not_scanned',
    );
  }
  let stream;
  try {
    stream = await storage().get(file.storageKey);
  } catch (err) {
    logger().error({ err, fileId: file._id.toString() }, 'stored object missing or unreadable');
    throw errors.notFound('File content');
  }
  const inlineSafe =
    opts.inline && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mimeType);
  const encoded = encodeURIComponent(file.originalName);
  const ascii = file.originalName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  res.setHeader('Content-Type', inlineSafe ? file.mimeType : 'application/octet-stream');
  res.setHeader('Content-Length', String(file.size));
  res.setHeader(
    'Content-Disposition',
    `${inlineSafe ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`,
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, no-store');
  stream.on('error', (err) => {
    logger().error({ err, requestId: req.id }, 'file stream failed');
    res.destroy(err);
  });
  // Commit headers before piping so the route layer knows the response is already being sent.
  res.status(200);
  res.flushHeaders();
  stream.pipe(res);
}
