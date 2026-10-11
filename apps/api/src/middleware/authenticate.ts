import type { RequestHandler } from 'express';
import { errors } from '../lib/errors';
import { User, type UserDoc } from '../models';
import { findActiveSession } from '../services/sessions';
import { COOKIES, verifyAccessToken } from '../services/tokens';

/**
 * Verifies the short-lived access token AND that its session is still active, so logout, password
 * changes and administrative revocation take effect immediately rather than when the token expires.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const token = req.cookies?.[COOKIES.access] as string | undefined;
    if (!token) throw errors.unauthenticated();
    const verified = await verifyAccessToken(token);
    if (!verified.ok) {
      throw verified.reason === 'expired'
        ? errors.unauthenticated('Your session needs to be refreshed.', 'token_expired')
        : errors.unauthenticated();
    }
    const session = await findActiveSession(verified.claims.sid);
    if (!session || session.userId.toString() !== verified.claims.sub) {
      throw errors.unauthenticated('Your session has ended. Sign in again.', 'session_revoked');
    }
    const user = await User.findById(verified.claims.sub).lean<UserDoc>();
    if (!user || user.status !== 'active') {
      throw errors.unauthenticated('This account is not active.', 'account_inactive');
    }
    req.auth = { userId: user._id.toString(), sessionId: session._id.toString(), user };
    next();
  } catch (err) {
    next(err);
  }
};
