import { z } from 'zod';
import { LIMITS } from '../constants';
import { COURSE_STATUSES, ENROLLMENT_ROLES } from '../enums';
import {
  emailSchema,
  objectIdSchema,
  optionalText,
  paginationQuerySchema,
  searchSchema,
  sortSchema,
  text,
} from './common';

export const createCourseSchema = z
  .object({
    code: text(LIMITS.courseCode).transform((v) => v.toUpperCase()),
    title: text(LIMITS.courseTitle),
    description: optionalText(LIMITS.courseDescription),
    term: text(LIMITS.term),
    departmentId: objectIdSchema.nullable().optional(),
    /** Org admins may assign instructors at creation; teachers become the instructor automatically. */
    instructorIds: z.array(objectIdSchema).max(10).optional(),
  })
  .strict();
export type CreateCourseInput = z.input<typeof createCourseSchema>;

export const updateCourseSchema = z
  .object({
    code: text(LIMITS.courseCode)
      .transform((v) => v.toUpperCase())
      .optional(),
    title: text(LIMITS.courseTitle).optional(),
    description: z.string().trim().max(LIMITS.courseDescription).optional(),
    term: text(LIMITS.term).optional(),
    departmentId: objectIdSchema.nullable().optional(),
  })
  .strict();
export type UpdateCourseInput = z.input<typeof updateCourseSchema>;

export const listCoursesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(COURSE_STATUSES).optional(),
  departmentId: objectIdSchema.optional(),
  term: z.string().trim().max(LIMITS.term).optional(),
  q: searchSchema,
  /** "mine" = courses the caller teaches or is enrolled in; "all" requires org admin (teachers: browse). */
  scope: z.enum(['mine', 'all']).default('mine'),
  sort: sortSchema(['code', 'title', 'term', 'createdAt'], 'code'),
});

export const sectionSchema = z.object({ name: text(LIMITS.sectionName) }).strict();
export const updateSectionSchema = z
  .object({ name: text(LIMITS.sectionName).optional(), status: z.enum(['active', 'archived']).optional() })
  .strict();

export const addEnrollmentSchema = z
  .object({
    /** Enrol an existing member by user id … */
    userId: objectIdSchema.optional(),
    /** … or by email. Unknown emails receive an organization invitation that enrols them on acceptance. */
    email: emailSchema.optional(),
    role: z.enum(ENROLLMENT_ROLES).default('student'),
    sectionId: objectIdSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => Boolean(v.userId) !== Boolean(v.email), {
    message: 'Provide either userId or email',
    path: ['email'],
  });
export type AddEnrollmentInput = z.input<typeof addEnrollmentSchema>;

export const updateEnrollmentSchema = z
  .object({
    sectionId: objectIdSchema.nullable().optional(),
    status: z.enum(['active', 'dropped']).optional(),
  })
  .strict();

export const rosterQuerySchema = paginationQuerySchema.extend({
  role: z.enum(ENROLLMENT_ROLES).optional(),
  sectionId: objectIdSchema.optional(),
  status: z.enum(['active', 'dropped']).default('active'),
  q: searchSchema,
  sort: sortSchema(['name', 'email', 'enrolledAt'], 'name'),
});

/** Roster CSV: header row required. Columns: email (required), name, role (student|instructor), section. */
export const rosterImportSchema = z
  .object({
    csv: z.string().min(1, 'The file is empty').max(LIMITS.csvImportBytes, 'File is larger than 1 MB'),
  })
  .strict();

export const rosterImportRowSchema = z.object({
  email: emailSchema,
  name: z.string().trim().max(LIMITS.name).optional().default(''),
  role: z.enum(ENROLLMENT_ROLES).default('student'),
  section: z.string().trim().max(LIMITS.sectionName).optional().default(''),
});
export type RosterImportRow = z.infer<typeof rosterImportRowSchema>;
