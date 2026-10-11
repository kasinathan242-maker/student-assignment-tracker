import axios, { type AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import { CSRF_HEADER, type ApiErrorBody } from '@sat/shared';

/** Normalised API error. `fields` maps form field paths to messages for inline display. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string[]> = {},
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get isNetwork() {
    return this.status === 0;
  }
}

export const http = axios.create({ baseURL: '/api/v1', withCredentials: true, timeout: 60_000 });

const UNSAFE = new Set(['post', 'put', 'patch', 'delete']);

function readCookie(name: string): string | null {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

let csrfPromise: Promise<string> | null = null;
async function csrfToken(): Promise<string> {
  const existing = readCookie('sat_csrf');
  if (existing) return existing;
  csrfPromise ??= axios
    .get<{ csrfToken: string }>('/api/v1/auth/csrf', { withCredentials: true })
    .then((r) => r.data.csrfToken)
    .finally(() => {
      csrfPromise = null;
    });
  return csrfPromise;
}

http.interceptors.request.use(async (config) => {
  if (UNSAFE.has((config.method ?? 'get').toLowerCase())) {
    config.headers.set(CSRF_HEADER, await csrfToken());
  }
  return config;
});

/* ───────────── session refresh (single flight) ───────────── */

type SessionListener = () => void;
const expiredListeners = new Set<SessionListener>();
export function onSessionExpired(listener: SessionListener): () => void {
  expiredListeners.add(listener);
  return () => expiredListeners.delete(listener);
}

let refreshing: Promise<boolean> | null = null;
/** Exactly one refresh request runs at a time; concurrent 401s wait for it (avoids refresh-token reuse). */
export function refreshSession(): Promise<boolean> {
  refreshing ??= http
    .post('/auth/refresh', undefined, { _skipRefresh: true } as AxiosRequestConfig)
    .then(() => true)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

const NO_REFRESH = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/register', '/auth/csrf'];

http.interceptors.response.use(
  (res) => res,
  async (error: AxiosError<ApiErrorBody>) => {
    const config = error.config as
      (InternalAxiosRequestConfig & { _retried?: boolean; _skipRefresh?: boolean }) | undefined;
    const status = error.response?.status ?? 0;
    const code = error.response?.data?.error?.code;
    if (
      status === 401 &&
      config &&
      !config._retried &&
      !config._skipRefresh &&
      !NO_REFRESH.some((p) => config.url?.startsWith(p))
    ) {
      config._retried = true;
      if (await refreshSession()) return http(config);
      expiredListeners.forEach((l) => l());
    }
    // A rotated CSRF cookie (e.g. after login in another tab) — fetch a fresh one and retry once.
    if (status === 403 && code === 'csrf_invalid' && config && !config._retried) {
      config._retried = true;
      document.cookie = 'sat_csrf=; Max-Age=0; path=/';
      return http(config);
    }
    throw toApiError(error);
  },
);

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (axios.isAxiosError(error)) {
    const ax = error as AxiosError<ApiErrorBody>;
    if (!ax.response) {
      return new ApiError(
        0,
        'network_error',
        'We could not reach the server. Check your connection and try again.',
      );
    }
    const body = ax.response.data?.error;
    if (body)
      return new ApiError(ax.response.status, body.code, body.message, body.fields ?? {}, body.requestId);
    return new ApiError(
      ax.response.status,
      'http_error',
      `The server responded with an unexpected error (${ax.response.status}).`,
    );
  }
  return new ApiError(0, 'unknown', error instanceof Error ? error.message : 'Something went wrong.');
}

/* ───────────── typed helpers ───────────── */

export async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const clean = params
    ? Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null))
    : undefined;
  return (await http.get<T>(url, { params: clean })).data;
}
export async function post<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return (await http.post<T>(url, body ?? {}, config)).data;
}
export async function put<T>(url: string, body?: unknown): Promise<T> {
  return (await http.put<T>(url, body ?? {})).data;
}
export async function patch<T>(url: string, body?: unknown): Promise<T> {
  return (await http.patch<T>(url, body ?? {})).data;
}
export async function del<T>(url: string, body?: unknown): Promise<T> {
  return (await http.delete<T>(url, { data: body })).data;
}

export async function upload<T>(
  url: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  return (
    await http.post<T>(url, form, {
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(e.loaded / e.total);
      },
    })
  ).data;
}

/** Triggers a browser download of an authenticated API resource (cookies are sent automatically). */
export function downloadUrl(path: string): string {
  return path.startsWith('/api/') ? path : `/api/v1${path}`;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
