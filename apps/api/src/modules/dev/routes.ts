import { Router } from 'express';
import { z } from 'zod';
import { route } from '../../lib/route';
import { capturedEmails } from '../../services/email/provider';

/**
 * Development-only mailbox for the "file"/"memory" email providers. Registered ONLY when
 * DEV_MAILBOX_ENABLED=true and NODE_ENV is not production (startup validation enforces this), so the
 * captured verification/reset links are never reachable in a deployed environment.
 */
export function devRoutes(): Router {
  const r = Router();
  route(r, {
    method: 'get',
    path: '/dev/mail',
    summary: 'Captured outgoing emails (development only)',
    tags: ['Development'],
    access: 'public',
    query: z.object({ to: z.string().trim().toLowerCase().max(254).optional() }),
    handler: async ({ query }) => {
      const mail = await capturedEmails();
      return query.to ? mail.filter((m) => m.to === query.to) : mail;
    },
  });
  return r;
}
