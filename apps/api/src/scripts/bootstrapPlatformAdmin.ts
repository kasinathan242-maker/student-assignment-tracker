/* eslint-disable no-console */
import { emailSchema, passwordIssues } from '@sat/shared';
import { connectDatabase, disconnectDatabase } from '../db/connection';
import { AuditLog, User, defaultNotificationPreferences } from '../models';
import { hashPassword } from '../services/passwords';
import { revokeAllSessions } from '../services/sessions';

/**
 * Explicit, operator-only bootstrap of the first platform administrator. There is no HTTP path that can
 * create the first platform admin; run this from a trusted shell with database access:
 *
 *   BOOTSTRAP_PASSWORD='…' npm run bootstrap:platform-admin -- --email ops@example.org --name "Ops Team"
 *
 * If the account exists it is promoted (and its sessions revoked); otherwise it is created as verified.
 * The password is read from the environment so it never appears in shell history or process listings.
 */
async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const email = emailSchema.parse(arg('email'));
  const name = arg('name') ?? 'Platform Administrator';
  await connectDatabase();
  const existing = await User.findOne({ email });
  if (existing) {
    existing.platformRole = 'platform_admin';
    existing.emailVerifiedAt ??= new Date();
    await existing.save();
    await revokeAllSessions(existing._id, 'platform_role_changed');
    console.log(`Promoted existing account ${email} to platform administrator.`);
  } else {
    const password = process.env.BOOTSTRAP_PASSWORD;
    if (!password) throw new Error('Set BOOTSTRAP_PASSWORD to create a new account.');
    const issues = passwordIssues(password, { email });
    if (issues.length) throw new Error(`Weak password: ${issues.join(' ')}`);
    await User.create({
      email,
      name,
      passwordHash: await hashPassword(password),
      emailVerifiedAt: new Date(),
      platformRole: 'platform_admin',
      notificationPreferences: defaultNotificationPreferences(),
    });
    console.log(`Created platform administrator ${email}.`);
  }
  await AuditLog.create({
    orgId: null,
    actorId: null,
    action: 'platform.bootstrap_admin',
    targetType: 'user',
    targetId: email,
    metadata: { via: 'cli' },
    expiresAt: new Date(Date.now() + 3650 * 86_400_000),
  });
  await disconnectDatabase();
}

main().catch(async (err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
