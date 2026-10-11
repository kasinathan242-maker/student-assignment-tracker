import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { env, setEnv } from '../src/config/env';

describe('serving the built web app (npm start)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sat-web-'));
  const original = env();
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    mkdirSync(path.join(dir, 'assets'));
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>SPA</title>');
    writeFileSync(path.join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
    writeFileSync(path.join(dir, '.secret'), 'nope');
    setEnv({ ...original, WEB_DIST_DIR: dir });
    app = createApp();
  });
  afterAll(() => {
    setEnv(original);
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves index.html for client routes with the SPA CSP and no caching', async () => {
    const res = await request(app).get('/courses/123').expect(200);
    expect(res.text).toContain('<title>SPA</title>');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('caches fingerprinted assets and 404s missing ones instead of returning the SPA', async () => {
    const ok = await request(app).get('/assets/app-abc123.js').expect(200);
    expect(ok.headers['cache-control']).toContain('immutable');
    await request(app).get('/assets/missing.js').expect(404);
  });

  it('never answers API paths or dotfiles with the SPA', async () => {
    const res = await request(app).get('/api/v1/does-not-exist').expect(404);
    expect(res.body.error.code).toBe('not_found');
    await request(app).get('/api').expect(404);
    const dot = await request(app).get('/.secret');
    expect(dot.text).not.toContain('nope');
  });

  it('does not serve the SPA for non-GET requests', async () => {
    await request(app).post('/courses').expect(404);
  });

  it('refuses to start without a build', () => {
    setEnv({ ...original, WEB_DIST_DIR: path.join(dir, 'missing') });
    expect(() => createApp()).toThrow(/npm run build/);
    setEnv(original);
  });
});
