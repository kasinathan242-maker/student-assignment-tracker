import type { AssignmentStatus } from '../enums';

/**
 * Assignment lifecycle: Draft → Scheduled|Published → Closed → Archived.
 *
 *   draft      → scheduled (publishAt in the future) | published | archived
 *   scheduled  → draft (unschedule) | published (publish now / worker at publishAt) | archived
 *   published  → closed | archived
 *   closed     → published (reopen) | archived
 *   archived   → draft (restore, never published) | closed (restore, previously published)
 */
export type AssignmentAction =
  'schedule' | 'unschedule' | 'publish' | 'close' | 'reopen' | 'archive' | 'restore';

const TRANSITIONS: Record<AssignmentAction, Partial<Record<AssignmentStatus, true>>> = {
  schedule: { draft: true },
  unschedule: { scheduled: true },
  publish: { draft: true, scheduled: true },
  close: { published: true },
  reopen: { closed: true },
  archive: { draft: true, scheduled: true, published: true, closed: true },
  restore: { archived: true },
};

export function canTransitionAssignment(from: AssignmentStatus, action: AssignmentAction): boolean {
  return TRANSITIONS[action][from] === true;
}

export function nextAssignmentStatus(
  from: AssignmentStatus,
  action: AssignmentAction,
  context: { wasEverPublished: boolean },
): AssignmentStatus | null {
  if (!canTransitionAssignment(from, action)) return null;
  switch (action) {
    case 'schedule':
      return 'scheduled';
    case 'unschedule':
      return 'draft';
    case 'publish':
    case 'reopen':
      return 'published';
    case 'close':
      return 'closed';
    case 'archive':
      return 'archived';
    case 'restore':
      return context.wasEverPublished ? 'closed' : 'draft';
  }
}

/** Statuses in which students can see the assignment at all. */
export function isVisibleToStudents(status: AssignmentStatus): boolean {
  return status === 'published' || status === 'closed';
}

export function isEditable(status: AssignmentStatus): boolean {
  return status !== 'archived';
}

/**
 * Fields whose change after publication is "material": recorded in the change history and
 * announced to affected students.
 */
export const MATERIAL_ASSIGNMENT_FIELDS = [
  'dueAt',
  'availableFrom',
  'availableUntil',
  'gracePeriodMinutes',
  'latePolicy',
  'resubmission',
  'submissionMethods',
  'fileRules',
  'maxPoints',
  'sectionIds',
  'instructions',
  'extensionsAllowed',
] as const;
export type MaterialAssignmentField = (typeof MATERIAL_ASSIGNMENT_FIELDS)[number];

/** Material fields that also change when a student's work is due; these trigger deadline notices. */
export const DEADLINE_FIELDS: readonly MaterialAssignmentField[] = [
  'dueAt',
  'availableFrom',
  'availableUntil',
  'gracePeriodMinutes',
];
