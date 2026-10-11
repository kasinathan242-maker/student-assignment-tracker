import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env';
import { registry } from './lib/route';
import { logger } from './lib/logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { limits } from './middleware/rateLimit';
import { csrfProtection, noStore, requestContext } from './middleware/requestContext';
import { buildOpenApiDocument } from './openapi/document';
import { moduleRouters } from './modules';
import { webApp } from './web';

export function createApp(): Express {
  const config = env();
  const app = express();
  registry.length = 0;

  app.disable('x-powered-by');
  app.set('trust proxy', /^\d+$/.test(config.TRUST_PROXY) ? Number(config.TRUST_PROXY) : config.TRUST_PROXY);
  app.set('query parser', 'simple'); // no nested objects from query strings → no operator injection via ?a[$ne]=

  app.use(requestContext);
  app.use(
    pinoHttp({
      logger: logger(),
      genReqId: (req) => (req as express.Request).id,
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'info' : 'debug',
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url.split('?')[0],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/api/v1/health') },
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      frameguard: { action: 'deny' },
      hsts: config.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['content-type', 'x-csrf-token', 'idempotency-key', 'x-request-id'],
      exposedHeaders: ['x-request-id', 'retry-after'],
      maxAge: 600,
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '1500kb', strict: true }));

  const api = Router();
  api.use(noStore);
  api.use(limits.api());
  api.use(csrfProtection);
  for (const router of moduleRouters()) api.use(router);

  api.get('/openapi.json', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.json(buildOpenApiDocument());
  });

  app.use('/api/v1', api);
  if (config.WEB_DIST_DIR) app.use(webApp(config.WEB_DIST_DIR));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
