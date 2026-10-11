import type { RequestHandler } from 'express';
import { IDEMPOTENCY_HEADER } from '@sat/shared';
import { isDuplicateKeyError } from '../db/connection';
import { sha256Hex } from '../lib/crypto';
import { errors } from '../lib/errors';
import { IdempotencyRecord, type IdempotencyDoc } from '../models';

const KEY_PATTERN = /^[A-Za-z0-9_:.-]{8,128}$/;
const TTL_MS = 24 * 3600_000;

/**
 * Idempotency for non-idempotent POSTs (e.g. final submission). When the client sends an
 * `Idempotency-Key`, the first successful (2xx) response is stored and replayed for retries with the same
 * key and body. A retry while the first attempt is still running gets 409; a key reused with a different
 * body gets 422. Failed attempts release the key so the client can retry.
 */
export const idempotent: RequestHandler = async (req, res, next) => {
  const key = req.get(IDEMPOTENCY_HEADER);
  if (!key) return next();
  try {
    if (!KEY_PATTERN.test(key))
      throw errors.validation('Invalid Idempotency-Key header.', undefined, 'invalid_idempotency_key');
    if (!req.auth) throw errors.unauthenticated();
    const scope = `${req.method} ${req.originalUrl.split('?')[0]}`;
    const requestHash = sha256Hex(JSON.stringify(req.body ?? null));
    const identity = { userId: req.auth.userId, scope, key };

    try {
      await IdempotencyRecord.create({
        ...identity,
        requestHash,
        state: 'in_progress',
        expiresAt: new Date(Date.now() + TTL_MS),
      });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      const existing = await IdempotencyRecord.findOne(identity).lean<IdempotencyDoc>();
      if (!existing) throw errors.conflict('Please retry the request.', 'idempotency_retry');
      if (existing.requestHash !== requestHash) {
        throw errors.validation(
          'This Idempotency-Key was already used with a different request.',
          undefined,
          'idempotency_key_reuse',
        );
      }
      if (existing.state === 'in_progress') {
        throw errors.conflict('This request is already being processed.', 'request_in_progress');
      }
      res.setHeader('Idempotent-Replayed', 'true');
      res.status(existing.statusCode ?? 200).json(existing.responseBody);
      return;
    }

    let captured: unknown;
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      captured = body;
      return originalJson(body);
    };
    res.on('finish', () => {
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      const op = ok
        ? IdempotencyRecord.updateOne(identity, {
            $set: { state: 'completed', statusCode: res.statusCode, responseBody: captured ?? null },
          })
        : IdempotencyRecord.deleteOne(identity);
      void op.exec().catch(() => undefined);
    });
    next();
  } catch (err) {
    next(err);
  }
};
