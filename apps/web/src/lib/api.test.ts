import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, get, http, onSessionExpired, post } from './api';

/** Scripted transport: each handler receives the request config and returns [status, body]. */
function useTransport(handler: (config: InternalAxiosRequestConfig) => [number, unknown]) {
  const calls: InternalAxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = async (config) => {
    calls.push(config);
    const [status, data] = handler(config);
    const response = { data, status, statusText: String(status), headers: {}, config };
    if (status >= 400) {
      const { AxiosError } = await import('axios');
      throw new AxiosError('fail', String(status), config, null, response);
    }
    return response;
  };
  http.defaults.adapter = adapter;
  return calls;
}

beforeEach(() => {
  document.cookie = 'sat_csrf=nonce.signature; path=/';
});
afterEach(() => {
  http.defaults.adapter = undefined;
});

describe('API client', () => {
  it('sends the CSRF header on state-changing requests only', async () => {
    const calls = useTransport(() => [200, {}]);
    await get('/x');
    await post('/y', { a: 1 });
    expect(calls[0]?.headers.get('x-csrf-token')).toBeUndefined();
    expect(calls[1]?.headers.get('x-csrf-token')).toBe('nonce.signature');
  });

  it('normalises error envelopes and network failures', async () => {
    useTransport(() => [
      409,
      { error: { code: 'stale_revision', message: 'Changed elsewhere', requestId: 'r1', fields: {} } },
    ]);
    await expect(post('/z')).rejects.toMatchObject({ status: 409, code: 'stale_revision', requestId: 'r1' });
    http.defaults.adapter = async () => {
      const { AxiosError } = await import('axios');
      throw new AxiosError('Network Error', 'ERR_NETWORK');
    };
    const error = await get('/z').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isNetwork).toBe(true);
  });

  it('refreshes once for concurrent 401s and retries the original requests', async () => {
    let refreshed = false;
    const calls = useTransport((config) => {
      if (config.url === '/auth/refresh') {
        refreshed = true;
        return [200, {}];
      }
      return refreshed
        ? [200, { ok: config.url }]
        : [401, { error: { code: 'token_expired', message: 'expired' } }];
    });
    const [a, b] = await Promise.all([get<{ ok: string }>('/a'), get<{ ok: string }>('/b')]);
    expect(a.ok).toBe('/a');
    expect(b.ok).toBe('/b');
    expect(calls.filter((c) => c.url === '/auth/refresh')).toHaveLength(1);
  });

  it('reports session expiry when the refresh fails', async () => {
    useTransport((config) =>
      config.url === '/auth/refresh'
        ? [401, { error: { code: 'session_invalid', message: 'x' } }]
        : [401, { error: { code: 'token_expired', message: 'x' } }],
    );
    const listener = vi.fn();
    const off = onSessionExpired(listener);
    await expect(get('/secret')).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });
});
