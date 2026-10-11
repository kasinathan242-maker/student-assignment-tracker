import { z } from 'zod';
import { LIMITS } from '../constants';
import { NOTIFICATION_PREFERENCE_KEYS } from '../enums';
import { passwordIssues } from '../domain/password';
import { emailSchema, localeSchema, text, timezoneSchema } from './common';

/** Password field for *new* passwords. Strength rules live in domain/password.ts. */
export const newPasswordSchema = z
  .string()
  .max(LIMITS.passwordMax * 4) // bytes guard before normalisation; the character rule is enforced below
  .superRefine((value, ctx) => {
    for (const issue of passwordIssues(value)) ctx.addIssue({ code: 'custom', message: issue });
  });

/** Password field for *existing* passwords — never apply strength rules when logging in. */
export const currentPasswordSchema = z
  .string()
  .min(1, 'Enter your password')
  .max(LIMITS.passwordMax * 4);

const opaqueToken = z.string().trim().min(16).max(256);

export const registerSchema = z
  .object({
    name: text(LIMITS.name),
    email: emailSchema,
    password: newPasswordSchema,
    /** Accept an invitation during registration. The invited address must match `email`. */
    invitationToken: opaqueToken.optional(),
    /** Join an organization that allows self-registration. */
    joinCode: z.string().trim().max(LIMITS.joinCode).optional(),
    timezone: timezoneSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const issue of passwordIssues(value.password, { email: value.email, name: value.name })) {
      if (!passwordIssues(value.password).includes(issue)) {
        ctx.addIssue({ code: 'custom', path: ['password'], message: issue });
      }
    }
  });
export type RegisterInput = z.input<typeof registerSchema>;

/** The three sign-in pages. Each admits only accounts that hold that role (checked by the server). */
export const LOGIN_PORTALS = ['student', 'teacher', 'admin'] as const;
export const loginPortalSchema = z.enum(LOGIN_PORTALS);
export type LoginPortal = z.infer<typeof loginPortalSchema>;

export const loginSchema = z
  .object({ email: emailSchema, password: currentPasswordSchema, portal: loginPortalSchema.optional() })
  .strict();
export type LoginInput = z.input<typeof loginSchema>;

export const tokenSchema = z.object({ token: opaqueToken }).strict();

/** Verification also proves knowledge of the account password (prevents pre-account takeover). */
export const verifyEmailSchema = z.object({ token: opaqueToken, password: currentPasswordSchema }).strict();

export const forgotPasswordSchema = z.object({ email: emailSchema }).strict();

export const resetPasswordSchema = z.object({ token: opaqueToken, password: newPasswordSchema }).strict();

export const changePasswordSchema = z
  .object({ currentPassword: currentPasswordSchema, newPassword: newPasswordSchema })
  .strict()
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ['newPassword'],
    message: 'Choose a password different from your current one.',
  });

export const updateProfileSchema = z
  .object({
    name: text(LIMITS.name).optional(),
    timezone: timezoneSchema.optional(),
    locale: localeSchema.optional(),
  })
  .strict();
export type UpdateProfileInput = z.input<typeof updateProfileSchema>;

const channelPrefs = z.object(
  Object.fromEntries(NOTIFICATION_PREFERENCE_KEYS.map((k) => [k, z.boolean()])) as Record<
    (typeof NOTIFICATION_PREFERENCE_KEYS)[number],
    z.ZodBoolean
  >,
);

export const notificationPreferencesSchema = z
  .object({
    inApp: channelPrefs,
    email: channelPrefs,
    reminderOffsetsMinutes: z
      .array(
        z
          .number()
          .int()
          .min(5)
          .max(14 * 24 * 60),
      )
      .max(5)
      .nullable(),
  })
  .strict();
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const joinOrganizationSchema = z
  .object({ joinCode: z.string().trim().min(4).max(LIMITS.joinCode) })
  .strict();
