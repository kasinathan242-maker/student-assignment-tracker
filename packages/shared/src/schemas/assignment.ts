import { z } from 'zod';
import { ALLOWED_UPLOAD_EXTENSIONS, LIMITS } from '../constants';
import { ASSIGNMENT_STATUSES, ASSIGNMENT_TYPES, GRADE_RELEASE_MODES, LATE_POLICY_MODES } from '../enums';
import {
  booleanQuerySchema,
  isoDateTimeSchema,
  objectIdSchema,
  paginationQuerySchema,
  revSchema,
  searchSchema,
  sortSchema,
  text,
  timezoneSchema,
} from './common';

export const latePolicySchema = z
  .object({
    mode: z.enum(LATE_POLICY_MODES),
    penaltyPercentPerDay: z.number().min(0).max(100),
    maxLateDays: z.number().int().min(0).max(365).nullable(),
  })
  .strict();

export const resubmissionPolicySchema = z
  .object({
    allowed: z.boolean(),
    maxAttempts: z.number().int().min(1).max(50).nullable(),
  })
  .strict();

export const submissionMethodsSchema = z
  .object({ text: z.boolean(), file: z.boolean(), url: z.boolean() })
  .strict()
  .refine((m) => m.text || m.file || m.url, { message: 'Select at least one submission method' });

export const fileRulesSchema = z
  .object({
    allowedExtensions: z.array(z.enum(ALLOWED_UPLOAD_EXTENSIONS)).max(LIMITS.allowedExtensions),
    maxFiles: z.number().int().min(1).max(LIMITS.maxFilesPerSubmission),
    maxFileSizeMb: z.number().int().min(1).max(LIMITS.maxFileSizeMb),
  })
  .strict();

/**
 * Field schemas without defaults. Zod 4 applies defaults even inside `.optional()`, so the update schema
 * must be derived from default-free fields or omitted fields would be silently reset.
 */
const assignmentFields = {
  title: text(LIMITS.assignmentTitle),
  description: z.string().trim().max(LIMITS.assignmentDescription),
  instructions: z.string().trim().max(LIMITS.assignmentInstructions),
  type: z.enum(ASSIGNMENT_TYPES),
  learningObjectives: z.array(text(LIMITS.learningObjectiveLength)).max(LIMITS.learningObjectives),
  maxPoints: z.number().min(0).max(LIMITS.maxPoints),
  rubricId: objectIdSchema.nullable(),
  availableFrom: isoDateTimeSchema.nullable(),
  dueAt: isoDateTimeSchema,
  availableUntil: isoDateTimeSchema.nullable(),
  timezone: timezoneSchema,
  gracePeriodMinutes: z
    .number()
    .int()
    .min(0)
    .max(24 * 60),
  latePolicy: latePolicySchema,
  resubmission: resubmissionPolicySchema,
  submissionMethods: submissionMethodsSchema,
  fileRules: fileRulesSchema,
  sectionIds: z.array(objectIdSchema).max(50),
  extensionsAllowed: z.boolean(),
  gradeRelease: z.enum(GRADE_RELEASE_MODES),
};

export interface AssignmentScheduleFields {
  availableFrom?: string | Date | null;
  dueAt?: string | Date;
  availableUntil?: string | Date | null;
  submissionMethods?: { file: boolean };
  fileRules?: { allowedExtensions: readonly string[] };
  latePolicy?: { mode: string; maxLateDays: number | null };
}

/** Cross-field rules shared by create and (merged) update validation. Returns field path → message. */
export function assignmentCrossFieldIssues(v: AssignmentScheduleFields): Record<string, string> {
  const issues: Record<string, string> = {};
  const t = (d: string | Date | null | undefined) => (d == null ? null : new Date(d).getTime());
  const from = t(v.availableFrom);
  const due = t(v.dueAt);
  const until = t(v.availableUntil);
  if (from != null && due != null && from >= due) issues.availableFrom = 'Must be before the due date';
  if (until != null && due != null && until < due) issues.availableUntil = 'Must be on or after the due date';
  if (v.submissionMethods?.file && v.fileRules && v.fileRules.allowedExtensions.length === 0) {
    issues['fileRules.allowedExtensions'] = 'Choose at least one allowed file type';
  }
  return issues;
}

export const createAssignmentSchema = z
  .object({
    ...assignmentFields,
    description: assignmentFields.description.default(''),
    instructions: assignmentFields.instructions.default(''),
    learningObjectives: assignmentFields.learningObjectives.default([]),
    rubricId: assignmentFields.rubricId.default(null),
    availableFrom: assignmentFields.availableFrom.default(null),
    availableUntil: assignmentFields.availableUntil.default(null),
    gracePeriodMinutes: assignmentFields.gracePeriodMinutes.default(0),
    sectionIds: assignmentFields.sectionIds.default([]),
    extensionsAllowed: assignmentFields.extensionsAllowed.default(false),
    gradeRelease: assignmentFields.gradeRelease.default('immediate'),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const [path, message] of Object.entries(assignmentCrossFieldIssues(v))) {
      ctx.addIssue({ code: 'custom', path: path.split('.'), message });
    }
  });
export type CreateAssignmentInput = z.input<typeof createAssignmentSchema>;
export type CreateAssignmentData = z.output<typeof createAssignmentSchema>;

export const updateAssignmentSchema = z
  .object(assignmentFields)
  .partial()
  .extend({
    expectedRev: revSchema,
    /** Optional explanation recorded with material changes to a published assignment. */
    changeNote: z.string().trim().max(LIMITS.correctionReason).optional(),
  })
  .strict();
export type UpdateAssignmentInput = z.input<typeof updateAssignmentSchema>;

export const scheduleAssignmentSchema = z
  .object({ publishAt: isoDateTimeSchema, expectedRev: revSchema })
  .strict();
export const assignmentTransitionSchema = z
  .object({ expectedRev: revSchema, note: z.string().trim().max(LIMITS.correctionReason).optional() })
  .strict();
export const duplicateAssignmentSchema = z
  .object({
    targetCourseId: objectIdSchema.optional(),
    title: text(LIMITS.assignmentTitle).optional(),
  })
  .strict();

export const listAssignmentsQuerySchema = paginationQuerySchema.extend({
  courseId: objectIdSchema.optional(),
  status: z.enum(ASSIGNMENT_STATUSES).optional(),
  type: z.enum(ASSIGNMENT_TYPES).optional(),
  q: searchSchema,
  dueFrom: isoDateTimeSchema.optional(),
  dueTo: isoDateTimeSchema.optional(),
  /** Student-only filter on their own derived status. */
  bucket: z.enum(['upcoming', 'pending', 'submitted', 'overdue', 'graded', 'returned']).optional(),
  includeArchived: booleanQuerySchema,
  sort: sortSchema(['dueAt', 'title', 'createdAt', 'status'], 'dueAt'),
});
export type ListAssignmentsQuery = z.input<typeof listAssignmentsQuerySchema>;
