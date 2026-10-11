import { jwtVerify, SignJWT, errors as joseErrors } from 'jose';
import type { CookieOptions, Request, Response } from 'express';
import { env } from '../config/env';
import { hmac, randomToken, safeEqual } from '../lib/crypto';

const ISSUER = 'sat-api';
const AUDIENCE = 'sat-web';

export const COOKIES = {
  access: 'sat_at',
  refresh: 'sat_rt',
  csrf: 'sat_csrf',
} as const;

const key = () => new TextEncoder().encode(env().JWT_ACCESS_SECRET);

export interface AccessClaims {
  sub: string;
  sid: string;
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ sid: claims.sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${env().ACCESS_TOKEN_TTL_MINUTES}m`)
    .sign(key());
}

export type AccessVerification =
  { ok: true; claims: AccessClaims } | { ok: false; reason: 'expired' | 'invalid' };

export async function verifyAccessToken(token: string): Promise<AccessVerification> {
  try {
    const { payload } = await jwtVerify(token, key(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string')
      return { ok: false, reason: 'invalid' };
    return { ok: true, claims: { sub: payload.sub, sid: payload.sid } };
  } catch (err) {
    return { ok: false, reason: err instanceof joseErrors.JWTExpired ? 'expired' : 'invalid' };
  }
}

function baseCookie(): CookieOptions {
  return { httpOnly: true, secure: env().COOKIE_SECURE, sameSite: 'lax' };
}

export function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
  refreshExpires: Date,
): void {
  res.cookie(COOKIES.access, accessToken, {
    ...baseCookie(),
    path: '/api',
    maxAge: env().ACCESS_TOKEN_TTL_MINUTES * 60_000,
  });
  // The refresh token is only ever sent to the auth endpoints and never to cross-site requests.
  res.cookie(COOKIES.refresh, refreshToken, {
    ...baseCookie(),
    sameSite: 'strict',
    path: '/api/v1/auth',
    expires: refreshExpires,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(COOKIES.access, { ...baseCookie(), path: '/api' });
  res.clearCookie(COOKIES.refresh, { ...baseCookie(), sameSite: 'strict', path: '/api/v1/auth' });
}

/**
 * CSRF: signed double-submit token. The token is readable by the SPA (non-HttpOnly cookie) and must be
 * echoed in the `x-csrf-token` header on every state-changing request. The HMAC prevents an attacker who
 * can plant cookies (e.g. from a sibling subdomain) from choosing a valid value.
 */
export function issueCsrfToken(res: Response): string {
  const nonce = randomToken(18);
  const token = `${nonce}.${hmac(env().CSRF_SECRET, nonce)}`;
  res.cookie(COOKIES.csrf, token, {
    httpOnly: false,
    secure: env().COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
  });
  return token;
}

export function isValidCsrf(req: Request): boolean {
  const header = req.get('x-csrf-token');
  const cookie = req.cookies?.[COOKIES.csrf] as string | undefined;
  if (!header || !cookie || !safeEqual(header, cookie)) return false;
  const [nonce, sig] = header.split('.');
  if (!nonce || !sig) return false;
  return safeEqual(sig, hmac(env().CSRF_SECRET, nonce));
}

/** Returns the existing CSRF token if its signature is valid, otherwise issues a new one. */
export function currentCsrfToken(req: Request, res: Response): string {
  const cookie = req.cookies?.[COOKIES.csrf] as string | undefined;
  if (cookie) {
    const [nonce, sig] = cookie.split('.');
    if (nonce && sig && safeEqual(sig, hmac(env().CSRF_SECRET, nonce))) return cookie;
  }
  return issueCsrfToken(res);
}
