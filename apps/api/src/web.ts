import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { Router } from 'express';

/** Same policy the SPA needs: only its own scripts, styles (Radix sets inline styles), images and API calls. */
const SPA_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Serves the built web app (`npm run build`) on the API's origin so a single process runs the whole product.
 * Fingerprinted assets are cached for a year; everything else, including the client-route fallback to
 * index.html, is revalidated so new builds load immediately. `/api/*` never falls back to the SPA.
 */
export function webApp(dir: string): Router {
  const root = path.resolve(dir);
  const index = path.join(root, 'index.html');
  if (!existsSync(index)) {
    throw new Error(`WEB_DIST_DIR has no index.html (${root}). Run \`npm run build\` first.`);
  }

  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', SPA_CSP);
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    next();
  });
  router.use(
    '/assets',
    express.static(path.join(root, 'assets'), {
      immutable: true,
      maxAge: '1y',
      index: false,
      fallthrough: true,
    }),
  );
  router.use(
    express.static(root, {
      index: false,
      dotfiles: 'ignore',
      setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
    }),
  );
  router.use((req, res, next) => {
    if (
      (req.method !== 'GET' && req.method !== 'HEAD') ||
      req.path === '/api' ||
      req.path.startsWith('/api/') ||
      req.path.startsWith('/assets/')
    ) {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
  return router;
}
