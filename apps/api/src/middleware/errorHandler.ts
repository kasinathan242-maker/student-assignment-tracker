import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { MulterError } from 'multer';
import type { ApiErrorBody } from '@sat/shared';
import { AppError, errors } from '../lib/errors';
import { logger } from '../lib/logger';
import { reportError } from '../services/errorReporter';

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(errors.notFound('Endpoint'));

function normalize(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return errors.tooLarge('The file is larger than the allowed size.');
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return errors.validation('Too many files or an unexpected file field.');
    }
    return errors.validation('The upload could not be processed.');
  }
  if (typeof err === 'object' && err !== null) {
    const e = err as { type?: string; status?: number; code?: number; name?: string };
    if (e.type === 'entity.too.large') return errors.tooLarge('The request body is too large.');
    if (e.type === 'entity.parse.failed')
      return errors.validation('The request body is not valid JSON.', undefined, 'invalid_json');
    if (e.code === 11000) return errors.conflict('This record already exists.', 'duplicate');
    if (err instanceof mongoose.Error.CastError) return errors.validation('Invalid identifier.');
    if (err instanceof mongoose.Error.ValidationError) {
      const fields: Record<string, string[]> = {};
      for (const [path, detail] of Object.entries(err.errors)) fields[path] = [detail.message];
      return errors.validation('Some fields are invalid.', fields);
    }
    if (
      e.name === 'MongoServerSelectionError' ||
      e.name === 'MongoNetworkError' ||
      e.name === 'MongoNotConnectedError' ||
      (e.name === 'MongooseError' &&
        /buffering|not connected|Client must be connected/i.test(String((err as Error).message)))
    ) {
      return errors.dependency(
        'The database is temporarily unavailable. Please try again shortly.',
        'database_unavailable',
      );
    }
  }
  return new AppError('internal', 'internal_error', 'Something went wrong on our side. Please try again.');
}

/** Converts any error into the documented error envelope; stack traces never reach clients. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appError = normalize(err);
  if (appError.status >= 500) {
    logger().error({ err, requestId: req.id, route: req.originalUrl, method: req.method }, 'request failed');
    reportError(err, { requestId: req.id, route: req.route?.path ?? req.path, method: req.method });
  } else if (appError.status !== 401 && appError.status !== 404) {
    logger().info({ code: appError.code, status: appError.status, requestId: req.id }, 'request rejected');
  }
  if (res.headersSent) return;
  for (const [k, v] of Object.entries(appError.headers ?? {})) res.setHeader(k, v);
  const body: ApiErrorBody = {
    error: {
      code: appError.code,
      message: appError.message,
      requestId: String(req.id),
      ...(appError.fields ? { fields: appError.fields } : {}),
    },
  };
  res.status(appError.status).json(body);
};
