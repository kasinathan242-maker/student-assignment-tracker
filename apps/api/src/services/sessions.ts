import type { Request, Response } from 'express';
import { env } from '../config/env';
import { hashToken, randomToken } from '../lib/crypto';
import { errors } from '../lib/errors';
import { logger } from '../lib/logger';
import { ipPrefix, userAgent } from '../lib/request';
import { Session, type Id, type SessionDoc } from '../models';
import { audit } from './audit';
import { clearAuthCookies, COOKIES, issueCsrfToken, setAuthCookies, signAccessToken } from './tokens';

const MAX_PREVIOUS_HASHES = 20;

/** Creates a new refresh-session family for a successful login and sets cookies. */
export async function startSession(
  req: Request,
  res: Response,
  userId: Id,
): Promise<{ sessionId: string; csrfToken: string }> {
  const refreshToken = randomToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + env().REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  const session = await Session.create({
    userId,
    refreshTokenHash: hashToken(refreshToken),
    userAgent: userAgent(req),
    ipPrefix: ipPrefix(req.ip),
    lastUsedAt: now,
    expiresAt,
  });
  const access = await signAccessToken({ sub: userId.toString(), sid: session._id.toString() });
  setAuthCookies(res, access, refreshToken, expiresAt);
  return { sessionId: session._id.toString(), csrfToken: issueCsrfToken(res) };
}

/**
 * Refresh-token rotation with replay detection:
 *  - a current token is exchanged for a new one (old hash moves to previousTokenHashes);
 *  - presenting a previously rotated token means it was copied — the whole session is revoked.
 * The web client serialises refresh calls, so legitimate concurrent reuse does not occur.
 */
export async function rotateSession(
  req: Request,
  res: Response,
): Promise<{ userId: string; sessionId: string; csrfToken: string }> {
  const presented = req.cookies?.[COOKIES.refresh] as string | undefined;
  if (!presented) throw errors.unauthenticated('Your session has ended. Sign in again.', 'session_missing');
  const presentedHash = hashToken(presented);
  const now = new Date();
  const nextToken = randomToken();
  const nextHash = hashToken(nextToken);

  const rotated = await Session.findOneAndUpdate(
    { refreshTokenHash: presentedHash, revokedAt: null, expiresAt: { $gt: now } },
    {
      $set: {
        refreshTokenHash: nextHash,
        lastUsedAt: now,
        ipPrefix: ipPrefix(req.ip),
        userAgent: userAgent(req),
      },
      $push: { previousTokenHashes: { $each: [presentedHash], $slice: -MAX_PREVIOUS_HASHES } },
    },
    { returnDocument: 'after' },
  );

  if (!rotated) {
    const replayed = await Session.findOne({ previousTokenHashes: presentedHash, revokedAt: null });
    if (replayed) {
      await revokeSession(replayed._id, 'refresh_token_replay');
      logger().warn(
        { sessionId: replayed._id.toString(), userId: replayed.userId.toString() },
        'refresh token replay detected',
      );
      await audit({
        req,
        action: 'auth.session.replay_detected',
        actorId: replayed.userId,
        targetType: 'session',
        targetId: replayed._id,
      });
    }
    clearAuthCookies(res);
    throw errors.unauthenticated('Your session has ended. Sign in again.', 'session_invalid');
  }

  const access = await signAccessToken({ sub: rotated.userId.toString(), sid: rotated._id.toString() });
  setAuthCookies(res, access, nextToken, rotated.expiresAt);
  return {
    userId: rotated.userId.toString(),
    sessionId: rotated._id.toString(),
    csrfToken: issueCsrfToken(res),
  };
}

export async function revokeSession(sessionId: Id | string, reason: string): Promise<void> {
  await Session.updateOne(
    { _id: sessionId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
}

export async function revokeAllSessions(
  userId: Id | string,
  reason: string,
  exceptSessionId?: string,
): Promise<number> {
  const filter: Record<string, unknown> = { userId, revokedAt: null };
  if (exceptSessionId) filter._id = { $ne: exceptSessionId };
  const result = await Session.updateMany(filter, { $set: { revokedAt: new Date(), revokedReason: reason } });
  return result.modifiedCount;
}

export async function findActiveSession(sessionId: string): Promise<SessionDoc | null> {
  return Session.findOne({
    _id: sessionId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  }).lean<SessionDoc>();
}
