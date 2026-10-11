import type { Paginated } from '@sat/shared';
import type { SortOrder } from 'mongoose';

/** Converts an allowlisted "field" / "-field" sort into a stable Mongo sort (ties broken by _id). */
export function toSort(sort: string, fieldMap: Record<string, string> = {}): Record<string, SortOrder> {
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  const path = fieldMap[field] ?? field;
  return { [path]: desc ? -1 : 1, _id: desc ? -1 : 1 };
}

export function paginate<T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export function skipFor(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}

/** Escapes user input for safe use inside a RegExp (case-insensitive substring search). */
export function searchRegex(q: string | undefined): RegExp | null {
  if (!q) return null;
  return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}
