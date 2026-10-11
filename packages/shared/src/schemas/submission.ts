import { z } from 'zod';
import { LIMITS } from '../constants';
import { ANNOUNCEMENT_AUDIENCES } from '../enums';
import {
  booleanQuerySchema,
  httpUrlSchema,
  isoDateTimeSchema,
  objectIdSchema,
  optionalText,
  paginationQuerySchema,
  revSchema,
  searchSchema,
  sortSchema,
  text,
} from './common';

/* ───────────── Submissions ───────────── */

export const saveDraftSchema = z
  .object({
    text: z.string().max(LIMITS.submissionText).nullable().optional(),
    url: z
      .union([httpUrlSchema, z.literal('')])
      .nullable()
      .optional(),
    fileIds: z.array(objectIdSchema).max(LIMITS.maxFilesPerSubmission).optional(),
    /** Omit only when creating the first draft. */
    expectedRev: revSchema.optional(),
  })
  .strict();
export type SaveDraftInput = z.input<typeof saveDraftSchema>;

export const submitSchema = z.object({ expectedRev: revSchema }).strict();

export const inboxQuerySchema = paginationQuerySchema.extend({
  status: z
    .enum(['all', 'submitted', 'late', 'needs_grading', 'graded', 'returned', 'missing', 'not_submitted'])
    .default('all'),
  sectionId: objectIdSchema.optional(),
  q: searchSchema,
  sort: sortSchema(['name', 'submittedAt', 'status'], '-submittedAt'),
});

/* ───────────── Grading ───────────── */

export const rubricScoreSchema = z
  .object({
    criterionId: z.string().min(1).max(64),
    points: z.number().min(0).max(LIMITS.maxPoints),
    comment: z.string().trim().max(LIMITS.feedback).optional(),
  })
  .strict();

export const saveGradeSchema = z
  .object({
    points: z.number().min(0).max(LIMITS.maxPoints).nullable().optional(),
    rubricScores: z.array(rubricScoreSchema).max(LIMITS.rubricCriteria).optional(),
    feedback: optionalText(LIMITS.feedback),
    privateNotes: optionalText(LIMITS.privateNotes),
    expectedRev: revSchema.optional(),
  })
  .strict();
export type SaveGradeInput = z.input<typeof saveGradeSchema>;

export const publishGradeSchema = z
  .object({
    /** Required when replacing an already-published grade. */
    reason: z.string().trim().max(LIMITS.correctionReason).optional(),
    expectedRev: revSchema.optional(),
  })
  .strict();

export const returnForRevisionSchema = z
  .object({ feedback: text(LIMITS.feedback), expectedRev: revSchema.optional() })
  .strict();

export const bulkPublishSchema = z
  .object({ submissionIds: z.array(objectIdSchema).min(1).max(500).optional() })
  .strict();

/* ───────────── Rubrics ───────────── */

export const rubricLevelSchema = z
  .object({
    title: text(80),
    points: z.number().min(0).max(LIMITS.maxPoints),
    description: z.string().trim().max(LIMITS.rubricCriterionDescription).optional(),
  })
  .strict();

export const rubricCriterionSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,64}$/)
      .optional(),
    title: text(LIMITS.rubricCriterionTitle),
    description: z.string().trim().max(LIMITS.rubricCriterionDescription).optional(),
    maxPoints: z.number().min(0).max(LIMITS.maxPoints),
    levels: z.array(rubricLevelSchema).max(LIMITS.rubricLevels).default([]),
  })
  .strict()
  .superRefine((c, ctx) => {
    c.levels.forEach((level, i) => {
      if (level.points > c.maxPoints) {
        ctx.addIssue({ code: 'custom', path: ['levels', i, 'points'], message: 'Exceeds criterion maximum' });
      }
    });
  });

export const rubricSchema = z
  .object({
    title: text(LIMITS.rubricTitle),
    description: optionalText(LIMITS.rubricCriterionDescription),
    courseId: objectIdSchema.nullable().default(null),
    criteria: z.array(rubricCriterionSchema).min(1, 'Add at least one criterion').max(LIMITS.rubricCriteria),
  })
  .strict();
export type RubricInput = z.input<typeof rubricSchema>;

export const updateRubricSchema = z
  .object({
    title: text(LIMITS.rubricTitle).optional(),
    description: z.string().trim().max(LIMITS.rubricCriterionDescription).optional(),
    criteria: z.array(rubricCriterionSchema).min(1).max(LIMITS.rubricCriteria).optional(),
    status: z.enum(['active', 'archived']).optional(),
    expectedRev: revSchema,
  })
  .strict();

export const listRubricsQuerySchema = paginationQuerySchema.extend({
  courseId: objectIdSchema.optional(),
  q: searchSchema,
  includeArchived: booleanQuerySchema,
});

/* ───────────── Extensions ───────────── */

export const requestExtensionSchema = z
  .object({ requestedDueAt: isoDateTimeSchema, reason: text(LIMITS.extensionReason) })
  .strict();

export const decideExtensionSchema = z
  .object({
    decision: z.enum(['approve', 'deny']),
    /** Defaults to the requested date when approving. */
    approvedDueAt: isoDateTimeSchema.optional(),
    note: optionalText(LIMITS.decisionNote),
  })
  .strict();

export const grantExtensionSchema = z
  .object({ studentId: objectIdSchema, dueAt: isoDateTimeSchema, note: optionalText(LIMITS.decisionNote) })
  .strict();

export const listExtensionsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['pending', 'approved', 'denied', 'cancelled']).optional(),
  assignmentId: objectIdSchema.optional(),
  courseId: objectIdSchema.optional(),
});

/* ───────────── Announcements ───────────── */

export const createAnnouncementSchema = z
  .object({
    title: text(LIMITS.announcementTitle),
    /** Markdown subset rendered without raw HTML. */
    body: text(LIMITS.announcementBody),
    courseId: objectIdSchema.nullable().default(null),
    audience: z.enum(ANNOUNCEMENT_AUDIENCES),
    publishAt: isoDateTimeSchema.nullable().default(null),
    expiresAt: isoDateTimeSchema.nullable().default(null),
    sendEmail: z.boolean().default(false),
    requireAck: z.boolean().default(false),
    /** Save without publishing. */
    draft: z.boolean().default(false),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.audience === 'course' && !v.courseId) {
      ctx.addIssue({ code: 'custom', path: ['courseId'], message: 'Choose a course' });
    }
    if (v.audience !== 'course' && v.courseId) {
      ctx.addIssue({
        code: 'custom',
        path: ['audience'],
        message: 'Course announcements use the course audience',
      });
    }
    if (v.publishAt && v.expiresAt && new Date(v.expiresAt) <= new Date(v.publishAt)) {
      ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Must be after the publish time' });
    }
  });
export type CreateAnnouncementInput = z.input<typeof createAnnouncementSchema>;

export const updateAnnouncementSchema = z
  .object({
    title: text(LIMITS.announcementTitle).optional(),
    body: text(LIMITS.announcementBody).optional(),
    publishAt: isoDateTimeSchema.nullable().optional(),
    expiresAt: isoDateTimeSchema.nullable().optional(),
    requireAck: z.boolean().optional(),
    expectedRev: revSchema,
  })
  .strict();

export const listAnnouncementsQuerySchema = paginationQuerySchema.extend({
  courseId: objectIdSchema.optional(),
  /** Authors/admins can include drafts, scheduled and archived announcements they manage. */
  manage: booleanQuerySchema,
  status: z.enum(['draft', 'scheduled', 'published', 'archived']).optional(),
});

/* ───────────── Notifications, calendar, reports ───────────── */

export const listNotificationsQuerySchema = paginationQuerySchema.extend({
  unreadOnly: booleanQuerySchema,
  orgId: objectIdSchema.optional(),
});

export const calendarQuerySchema = z
  .object({
    from: isoDateTimeSchema,
    to: isoDateTimeSchema,
    courseId: objectIdSchema.optional(),
  })
  .refine((v) => new Date(v.to).getTime() > new Date(v.from).getTime(), {
    path: ['to'],
    message: 'Must be after "from"',
  })
  .refine((v) => new Date(v.to).getTime() - new Date(v.from).getTime() <= 400 * 24 * 3600 * 1000, {
    path: ['to'],
    message: 'Range cannot exceed 400 days',
  });

export const reportRangeQuerySchema = z.object({
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});
