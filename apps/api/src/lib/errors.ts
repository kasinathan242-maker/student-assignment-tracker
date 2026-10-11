/**
 * Error taxonomy. Every error that reaches the client is one of these categories with a stable code;
 * anything else is reported as a sanitized 500.
 */
export type ErrorCategory =
  | 'validation'
  | 'authentication'
  | 'authorization'
  | 'not_found'
  | 'conflict'
  | 'rate_limit'
  | 'dependency'
  | 'payload_too_large'
  | 'internal';

const STATUS: Record<ErrorCategory, number> = {
  validation: 400,
  authentication: 401,
  authorization: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  rate_limit: 429,
  dependency: 503,
  internal: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly category: ErrorCategory,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string[]>,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = STATUS[category];
  }
}

export const errors = {
  validation: (message: string, fields?: Record<string, string[]>, code = 'validation_failed') =>
    new AppError('validation', code, message, fields),
  unauthenticated: (message = 'Sign in to continue.', code = 'unauthenticated') =>
    new AppError('authentication', code, message),
  forbidden: (message = 'You do not have permission to perform this action.', code = 'forbidden') =>
    new AppError('authorization', code, message),
  /** Used for both "missing" and "exists but not yours" so resource existence is not leaked. */
  notFound: (resource = 'Resource', code = 'not_found') =>
    new AppError('not_found', code, `${resource} not found.`),
  conflict: (message: string, code = 'conflict', fields?: Record<string, string[]>) =>
    new AppError('conflict', code, message, fields),
  staleRevision: () =>
    new AppError(
      'conflict',
      'stale_revision',
      'This item was changed by someone else. Reload to see the latest version, then try again.',
    ),
  rateLimited: (message = 'Too many requests. Please wait and try again.', retryAfterSeconds?: number) =>
    new AppError(
      'rate_limit',
      'rate_limited',
      message,
      undefined,
      retryAfterSeconds ? { 'Retry-After': String(retryAfterSeconds) } : undefined,
    ),
  dependency: (
    message = 'A required service is temporarily unavailable. Please try again shortly.',
    code = 'dependency_unavailable',
  ) => new AppError('dependency', code, message),
  tooLarge: (message: string) => new AppError('payload_too_large', 'payload_too_large', message),
};
