import type { UserDTO } from '@sat/shared';
import type { UserDoc } from '../../models';

/** Explicit allowlist — password hashes, lockout counters and preferences are never serialized here. */
export function serializeUser(user: UserDoc): UserDTO {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    emailVerified: Boolean(user.emailVerifiedAt),
    timezone: user.timezone,
    locale: user.locale,
    hasAvatar: Boolean(user.avatarFileId),
    platformRole: user.platformRole ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}
