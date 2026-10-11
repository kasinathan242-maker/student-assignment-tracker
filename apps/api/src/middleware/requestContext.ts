import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { errors } from '../lib/errors';
import { isValidCsrf } from '../services/tokens';

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Assigns a correlation id and the authoritative server receipt time. */
export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  req.id = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  req.receivedAt = new Date();
  res.setHeader('x-request-id', req.id);
  next();
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** CSRF enforcement for every state-changing request (see services/tokens.ts). */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!isValidCsrf(req))
    return next(
      errors.forbidden(
        'Your session security token is missing or expired. Reload the page and try again.',
        'csrf_invalid',
      ),
    );
  next();
};

/** Private API responses must never be stored by shared caches or the browser's back/forward cache. */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  next();
};
