import { Router } from 'express';
import { z } from 'zod';
import {
  emailSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  tokenSchema,
  verifyEmailSchema,
} from '@sat/shared';
import { limits } from '../../middleware/rateLimit';
import { route } from '../../lib/route';
import { Organization, Session, User } from '../../models';
import { audit } from '../../services/audit';
import { findActiveSession, revokeSession, rotateSession } from '../../services/sessions';
import { clearAuthCookies, COOKIES, issueCsrfToken, verifyAccessToken } from '../../services/tokens';
import { hashToken } from '../../lib/crypto';
import * as auth from './service';

export function authRoutes(): Router {
  const r = Router();
  const tags = ['Authentication'];

  route(r, {
    method: 'get',
    path: '/auth/csrf',
    summary: 'Issue a CSRF token (double-submit cookie + response body)',
    tags,
    access: 'public',
    handler: ({ res }) => ({ csrfToken: issueCsrfToken(res) }),
  });

  route(r, {
    method: 'post',
    path: '/auth/register',
    summary: 'Create an account (generic response for public sign-up; signs in when accepting an invitation)',
    tags,
    access: 'public',
    body: registerSchema,
    middleware: [limits.register()],
    handler: async ({ req, res, body }) => {
      const result = await auth.register(req, res, body);
      res.status(result.status === 'signed_in' ? 201 : 202);
      return result;
    },
  });

  route(r, {
    method: 'post',
    path: '/auth/login',
    summary: 'Sign in with email and password',
    tags,
    access: 'public',
    status: 200,
    body: loginSchema,
    middleware: [limits.loginIp(), limits.login()],
    handler: ({ req, res, body }) => auth.login(req, res, body.email, body.password, body.portal),
  });

  route(r, {
    method: 'post',
    path: '/auth/refresh',
    summary: 'Rotate the refresh session and issue a new access token',
    tags,
    access: 'public',
    status: 200,
    middleware: [limits.refresh()],
    handler: async ({ req, res }) => {
      const { userId, csrfToken } = await rotateSession(req, res);
      return auth.buildMe(userId, csrfToken);
    },
  });

  route(r, {
    method: 'post',
    path: '/auth/logout',
    summary: 'Sign out and revoke the current session',
    tags,
    access: 'public',
    status: 204,
    handler: async ({ req, res }) => {
      const refresh = req.cookies?.[COOKIES.refresh] as string | undefined;
      const access = req.cookies?.[COOKIES.access] as string | undefined;
      let sessionId: string | null = null;
      if (refresh) {
        const s = await Session.findOne({ refreshTokenHash: hashToken(refresh) })
          .select({ _id: 1 })
          .lean();
        sessionId = s?._id.toString() ?? null;
      }
      if (!sessionId && access) {
        const v = await verifyAccessToken(access);
        if (v.ok) sessionId = v.claims.sid;
      }
      if (sessionId) {
        const s = await findActiveSession(sessionId);
        await revokeSession(sessionId, 'logout');
        if (s)
          await audit({
            req,
            action: 'auth.logout',
            actorId: s.userId,
            targetType: 'session',
            targetId: sessionId,
          });
      }
      clearAuthCookies(res);
      issueCsrfToken(res);
    },
  });

  route(r, {
    method: 'post',
    path: '/auth/verify-email',
    summary: 'Confirm an email address with the single-use token and the account password',
    tags,
    access: 'public',
    status: 200,
    body: verifyEmailSchema,
    middleware: [limits.tokenRedemption()],
    handler: async ({ req, body }) => {
      await auth.verifyEmail(req, body.token, body.password);
      return { verified: true };
    },
  });

  route(r, {
    method: 'post',
    path: '/auth/resend-verification',
    summary: 'Resend the verification email (always returns 202)',
    tags,
    access: 'public',
    status: 202,
    body: z.object({ email: emailSchema }).strict(),
    middleware: [limits.passwordReset()],
    handler: async ({ body }) => {
      await auth.resendVerification(body.email);
      return { status: 'accepted' };
    },
  });

  route(r, {
    method: 'post',
    path: '/auth/forgot-password',
    summary: 'Request a password reset email (always returns 202; never reveals whether the account exists)',
    tags,
    access: 'public',
    status: 202,
    body: forgotPasswordSchema,
    middleware: [limits.passwordReset()],
    handler: async ({ req, body }) => {
      await auth.requestPasswordReset(req, body.email);
      return { status: 'accepted' };
    },
  });

  route(r, {
    method: 'post',
    path: '/auth/reset-password',
    summary: 'Set a new password with a single-use reset token; revokes all sessions',
    tags,
    access: 'public',
    status: 200,
    body: resetPasswordSchema,
    middleware: [limits.tokenRedemption()],
    handler: async ({ req, body }) => {
      await auth.resetPassword(req, body.token, body.password);
      return { reset: true };
    },
  });

  route(r, {
    method: 'post',
    path: '/invitations/preview',
    summary: 'Describe an invitation from its token (token sent in body, not URL)',
    tags: ['Invitations'],
    access: 'public',
    status: 200,
    body: tokenSchema,
    middleware: [limits.tokenRedemption()],
    handler: async ({ body }) => {
      const inv = await auth.findPendingInvitation(body.token);
      const org = await Organization.findById(inv.orgId).select({ name: 1 }).lean();
      return {
        orgName: org?.name ?? 'Organization',
        role: inv.role,
        email: inv.email,
        expiresAt: inv.expiresAt.toISOString(),
        accountExists: Boolean(await User.exists({ email: inv.email })),
      };
    },
  });

  return r;
}
