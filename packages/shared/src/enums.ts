/** Enumerations shared by the API (persistence + validation) and the web app (display). */

export const ORG_ROLES = ['student', 'teacher', 'org_admin'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const PLATFORM_ROLES = ['platform_admin'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const USER_STATUSES = ['active', 'suspended', 'deactivated'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const ORG_STATUSES = ['active', 'suspended'] as const;
export type OrgStatus = (typeof ORG_STATUSES)[number];

export const MEMBERSHIP_STATUSES = ['active', 'pending', 'suspended', 'revoked'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const SELF_REGISTRATION_MODES = ['disabled', 'approval', 'open'] as const;
export type SelfRegistrationMode = (typeof SELF_REGISTRATION_MODES)[number];

export const INVITATION_STATUSES = ['pending', 'accepted', 'revoked', 'expired'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const COURSE_STATUSES = ['active', 'archived'] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

export const ENROLLMENT_ROLES = ['instructor', 'student'] as const;
export type EnrollmentRole = (typeof ENROLLMENT_ROLES)[number];

export const ENROLLMENT_STATUSES = ['active', 'dropped'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const ASSIGNMENT_STATUSES = ['draft', 'scheduled', 'published', 'closed', 'archived'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const ASSIGNMENT_TYPES = [
  'homework',
  'essay',
  'project',
  'lab',
  'quiz',
  'presentation',
  'other',
] as const;
export type AssignmentType = (typeof ASSIGNMENT_TYPES)[number];

export const LATE_POLICY_MODES = ['reject', 'accept', 'penalize'] as const;
export type LatePolicyMode = (typeof LATE_POLICY_MODES)[number];

export const GRADE_RELEASE_MODES = ['immediate', 'hold'] as const;
export type GradeReleaseMode = (typeof GRADE_RELEASE_MODES)[number];

/** Persisted submission states. "not_started" is represented by the absence of a submission record. */
export const SUBMISSION_STATES = ['draft', 'submitted', 'returned', 'graded', 'withdrawn'] as const;
export type SubmissionState = (typeof SUBMISSION_STATES)[number];

/** Student-facing derived status, computed from the persisted state plus the deadline. */
export const SUBMISSION_DISPLAY_STATUSES = [
  'not_started',
  'draft',
  'submitted',
  'late',
  'resubmitted',
  'returned',
  'graded',
  'withdrawn',
  'overdue',
  'missing',
] as const;
export type SubmissionDisplayStatus = (typeof SUBMISSION_DISPLAY_STATUSES)[number];

export const EXTENSION_STATUSES = ['pending', 'approved', 'denied', 'cancelled'] as const;
export type ExtensionStatus = (typeof EXTENSION_STATUSES)[number];

export const ANNOUNCEMENT_STATUSES = ['draft', 'scheduled', 'published', 'archived'] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

export const ANNOUNCEMENT_AUDIENCES = ['course', 'org_all', 'org_students', 'org_teachers'] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

export const NOTIFICATION_TYPES = [
  'assignment_published',
  'assignment_updated',
  'deadline_changed',
  'deadline_reminder',
  'submission_received',
  'submission_confirmed',
  'submission_returned',
  'grade_published',
  'extension_requested',
  'extension_decided',
  'announcement',
  'invitation',
  'enrollment',
  'membership',
  'security',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Notification categories a user can toggle per channel. Security notices are always delivered. */
export const NOTIFICATION_PREFERENCE_KEYS = [
  'assignments',
  'deadlines',
  'submissions',
  'grades',
  'extensions',
  'announcements',
  'enrollment',
] as const;
export type NotificationPreferenceKey = (typeof NOTIFICATION_PREFERENCE_KEYS)[number];

export const NOTIFICATION_TYPE_CATEGORY: Record<NotificationType, NotificationPreferenceKey | 'security'> = {
  assignment_published: 'assignments',
  assignment_updated: 'assignments',
  deadline_changed: 'deadlines',
  deadline_reminder: 'deadlines',
  submission_received: 'submissions',
  submission_confirmed: 'submissions',
  submission_returned: 'grades',
  grade_published: 'grades',
  extension_requested: 'extensions',
  extension_decided: 'extensions',
  announcement: 'announcements',
  invitation: 'enrollment',
  enrollment: 'enrollment',
  membership: 'enrollment',
  security: 'security',
};

export const FILE_PURPOSES = ['submission', 'assignment_attachment', 'avatar'] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

export const FILE_SCAN_STATUSES = ['pending', 'clean', 'infected', 'skipped', 'error'] as const;
export type FileScanStatus = (typeof FILE_SCAN_STATUSES)[number];
