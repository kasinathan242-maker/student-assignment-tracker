import { env } from '../../config/env';

/**
 * Email templates. All interpolated values are HTML-escaped; links are always built from APP_URL so a
 * template can never be made to point at an attacker-controlled host. Secret tokens travel in the URL
 * fragment (#token=…), which browsers never send to servers or write to access logs.
 */
export const EMAIL_TEMPLATES = [
  'verify_email',
  'account_exists',
  'password_reset',
  'password_changed',
  'invitation',
  'notification',
] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

export function appLink(pathname: string, token?: string): string {
  const url = new URL(pathname.startsWith('/') ? pathname : `/${pathname}`, env().APP_URL);
  if (token) url.hash = `token=${encodeURIComponent(token)}`;
  return url.toString();
}

function layout(title: string, paragraphs: string[], action?: { label: string; url: string }): RenderedEmail {
  const htmlBody = paragraphs
    .map((p) => `<p style="margin:0 0 16px;line-height:1.5">${escape(p)}</p>`)
    .join('');
  const button = action
    ? `<p style="margin:24px 0"><a href="${escape(action.url)}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">${escape(action.label)}</a></p><p style="font-size:12px;color:#64748b">If the button does not work, copy this link into your browser:<br>${escape(action.url)}</p>`
    : '';
  const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;background:#f8fafc;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:24px"><h1 style="font-size:18px;margin:0 0 16px">${escape(title)}</h1>${htmlBody}${button}<p style="font-size:12px;color:#94a3b8;margin-top:24px">Assignment Tracker</p></div></body></html>`;
  const text = [title, '', ...paragraphs, ...(action ? ['', `${action.label}: ${action.url}`] : [])].join(
    '\n',
  );
  return { subject: title, text, html };
}

export function renderEmail(template: EmailTemplate, vars: Record<string, string>): RenderedEmail {
  switch (template) {
    case 'verify_email':
      return layout(
        'Confirm your email address',
        [
          `Hi ${vars.name ?? ''},`,
          'Confirm your email address to finish setting up your account. This link expires in 24 hours.',
        ],
        { label: 'Confirm email', url: appLink('/verify-email', vars.token) },
      );
    case 'account_exists':
      return layout(
        'You already have an account',
        [
          'Someone (hopefully you) tried to create an account with this email address, but one already exists.',
          'If you forgot your password, you can reset it. If this was not you, no action is needed.',
        ],
        { label: 'Reset password', url: appLink('/forgot-password') },
      );
    case 'password_reset':
      return layout(
        'Reset your password',
        [
          'We received a request to reset your password. This link expires in 30 minutes and can be used once.',
          'If you did not request this, you can ignore this email.',
        ],
        { label: 'Choose a new password', url: appLink('/reset-password', vars.token) },
      );
    case 'password_changed':
      return layout('Your password was changed', [
        'The password for your account was just changed and other sessions were signed out.',
        'If you did not do this, reset your password immediately and contact your administrator.',
      ]);
    case 'invitation':
      return layout(
        `You're invited to ${vars.orgName ?? 'an organization'}`,
        [
          `${vars.inviterName ?? 'An administrator'} invited you to join ${vars.orgName ?? ''} as ${vars.roleLabel ?? 'a member'}.`,
          'This invitation expires in 7 days.',
        ],
        { label: 'Accept invitation', url: appLink('/accept-invite', vars.token) },
      );
    case 'notification':
      return layout(
        vars.title ?? 'Notification',
        [vars.body ?? ''].filter(Boolean),
        vars.link ? { label: 'Open', url: appLink(vars.link) } : undefined,
      );
  }
}
