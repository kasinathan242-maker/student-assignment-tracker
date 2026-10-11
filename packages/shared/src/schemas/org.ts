import { z } from 'zod';
import { LIMITS } from '../constants';
import {
  LATE_POLICY_MODES,
  MEMBERSHIP_STATUSES,
  ORG_ROLES,
  ORG_STATUSES,
  SELF_REGISTRATION_MODES,
} from '../enums';
import {
  booleanQuerySchema,
  emailSchema,
  objectIdSchema,
  optionalText,
  paginationQuerySchema,
  searchSchema,
  slugSchema,
  sortSchema,
  text,
  timezoneSchema,
} from './common';

export const orgSettingsSchema = z
  .object({
    selfRegistration: z.enum(SELF_REGISTRATION_MODES),
    /** Restrict self-registration to these email domains (empty = any). */
    allowedEmailDomains: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'Invalid domain'),
      )
      .max(20),
    teachersCanCreateCourses: z.boolean(),
    csvImportEnabled: z.boolean(),
    reminderOffsetsMinutes: z
      .array(
        z
          .number()
          .int()
          .min(5)
          .max(14 * 24 * 60),
      )
      .min(0)
      .max(5),
    defaultLatePolicy: z.enum(LATE_POLICY_MODES),
    notificationRetentionDays: z.number().int().min(7).max(730),
    auditRetentionDays: z.number().int().min(90).max(3650),
  })
  .strict();
export type OrgSettings = z.infer<typeof orgSettingsSchema>;

export const updateOrgSchema = z
  .object({
    name: text(LIMITS.orgName).optional(),
    timezone: timezoneSchema.optional(),
    settings: orgSettingsSchema.partial().optional(),
    branding: z
      .object({
        primaryColor: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .nullable(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type UpdateOrgInput = z.input<typeof updateOrgSchema>;

export const createOrgSchema = z
  .object({
    name: text(LIMITS.orgName),
    slug: slugSchema,
    timezone: timezoneSchema,
    /** First organization administrator; receives an invitation. */
    adminEmail: emailSchema,
  })
  .strict();
export type CreateOrgInput = z.input<typeof createOrgSchema>;

export const setOrgStatusSchema = z
  .object({ status: z.enum(ORG_STATUSES), reason: text(LIMITS.correctionReason) })
  .strict();

export const rotateJoinCodeSchema = z.object({ enabled: z.boolean() }).strict();

export const createInvitationSchema = z
  .object({
    email: emailSchema,
    role: z.enum(ORG_ROLES),
    /** Optionally enrol the invitee as a student in a course when they accept. */
    courseId: objectIdSchema.optional(),
  })
  .strict();
export type CreateInvitationInput = z.input<typeof createInvitationSchema>;

export const listInvitationsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['pending', 'accepted', 'revoked', 'expired']).optional(),
  q: searchSchema,
});

export const listMembersQuerySchema = paginationQuerySchema.extend({
  role: z.enum(ORG_ROLES).optional(),
  status: z.enum(MEMBERSHIP_STATUSES).optional(),
  q: searchSchema,
  sort: sortSchema(['name', 'email', 'joinedAt', 'role'], 'name'),
});

export const updateMembershipSchema = z
  .object({
    role: z.enum(ORG_ROLES).optional(),
    status: z.enum(['active', 'suspended']).optional(),
    studentNumber: z.string().trim().max(LIMITS.studentNumber).nullable().optional(),
    departmentId: objectIdSchema.nullable().optional(),
    reason: optionalText(LIMITS.correctionReason),
  })
  .strict();

export const departmentSchema = z
  .object({
    name: text(LIMITS.departmentName),
    code: text(LIMITS.departmentCode).transform((v) => v.toUpperCase()),
  })
  .strict();

export const updateDepartmentSchema = z
  .object({
    name: text(LIMITS.departmentName).optional(),
    code: text(LIMITS.departmentCode)
      .transform((v) => v.toUpperCase())
      .optional(),
    status: z.enum(['active', 'archived']).optional(),
  })
  .strict();

export const auditQuerySchema = paginationQuerySchema.extend({
  action: z.string().trim().max(80).optional(),
  actorId: objectIdSchema.optional(),
  targetType: z.string().trim().max(40).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

export const adminAccessQuerySchema = z.object({ reason: text(LIMITS.correctionReason) });

export const platformRoleSchema = z
  .object({ grant: z.boolean(), reason: text(LIMITS.correctionReason) })
  .strict();

export const platformOrgsQuerySchema = paginationQuerySchema.extend({
  q: searchSchema,
  status: z.enum(ORG_STATUSES).optional(),
});

export const platformUsersQuerySchema = paginationQuerySchema.extend({
  q: searchSchema,
  platformAdmin: booleanQuerySchema,
});
