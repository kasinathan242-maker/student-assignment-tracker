import { env } from '../config/env';
import { logger } from '../lib/logger';

/**
 * Provider-neutral error monitoring. "log" relies on structured logs (ship them to your log platform);
 * "webhook" POSTs a sanitized event to ERROR_WEBHOOK_URL (e.g. an ingestion endpoint for Sentry/Datadog
 * relays or an internal alerting service). Request bodies, cookies and headers are never included.
 */
export function reportError(err: unknown, context: Record<string, unknown> = {}): void {
  const config = env();
  if (config.ERROR_REPORTER !== 'webhook' || !config.ERROR_WEBHOOK_URL) return;
  const error =
    err instanceof Error
      ? { name: err.name, message: err.message, stack: err.stack }
      : { message: String(err) };
  const payload = {
    service: 'sat-api',
    version: config.APP_VERSION,
    environment: config.NODE_ENV,
    timestamp: new Date().toISOString(),
    error,
    context,
  };
  void fetch(config.ERROR_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(3_000),
  }).catch((e: unknown) => logger().warn({ err: e }, 'error webhook delivery failed'));
}
