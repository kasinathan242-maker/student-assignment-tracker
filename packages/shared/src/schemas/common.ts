import { IANAZone } from 'luxon';
import { z } from 'zod';
import { LIMITS } from '../constants';
import './messages';

export const objectIdSchema = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid identifier');

/** Trimmed non-empty string with a maximum length. */
export const text = (max: number) => z.string().trim().min(1, 'Required').max(max);
/** Trimmed optional string; empty strings normalise to "". */
export const optionalText = (max: number) => z.string().trim().max(max).default('');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(LIMITS.email)
  .pipe(z.email({ message: 'Enter a valid email address' }));

export const timezoneSchema = z
  .string()
  .trim()
  .max(64)
  .refine((tz) => IANAZone.isValidZone(tz), 'Unknown time zone');

export const localeSchema = z
  .string()
  .trim()
  .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, 'Invalid locale');

/** ISO-8601 instant with an explicit offset (e.g. 2026-10-09T17:00:00Z). */
export const isoDateTimeSchema = z.iso.datetime({ offset: true, message: 'Invalid date/time' });

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(LIMITS.slug)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Use lowercase letters, numbers and hyphens');

export const httpUrlSchema = z
  .string()
  .trim()
  .max(LIMITS.url)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'Enter a valid http(s) URL');

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(LIMITS.pageSizeDefault),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const searchSchema = z.string().trim().max(LIMITS.searchQuery).optional();

/** Builds an allowlisted sort parameter: "field" or "-field". Arbitrary field paths are rejected. */
export function sortSchema<const T extends readonly [string, ...string[]]>(fields: T, fallback: string) {
  const allowed = new Set<string>(fields.flatMap((f) => [f, `-${f}`]));
  return z
    .string()
    .default(fallback)
    .refine((value) => allowed.has(value), { message: `Sort must be one of: ${[...allowed].join(', ')}` });
}

export const booleanQuerySchema = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

/** Optimistic-concurrency token returned with mutable resources and echoed back on update. */
export const revSchema = z.number().int().min(0);

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
    fields?: Record<string, string[]>;
  };
}
