/**
 * Response shapes returned by the API. Dates are ISO-8601 strings in UTC. These types are the contract
 * between apps/api serializers and apps/web; serializers are typed against them.
 */
import type {
  AnnouncementAudience,
  AnnouncementStatus,
  AssignmentStatus,
  AssignmentType,
  CourseStatus,
  EnrollmentRole,
  EnrollmentStatus,
  ExtensionStatus,
  FileScanStatus,
  GradeReleaseMode,
  InvitationStatus,
  MembershipStatus,
  NotificationType,
  OrgRole,
  OrgStatus,
  PlatformRole,
  SubmissionDisplayStatus,
  SubmissionState,
} from './enums';
import type { RubricCriterion, RubricScore } from './domain/grading';
import type { LatePolicy } from './domain/deadline';
import type { ResubmissionPolicy } from './domain/submissionState';
import type { NotificationPreferences } from './schemas/auth';
import type { OrgSettings } from './schemas/org';

export type ISODate = string;

export interface PersonRef {
  id: string;
  name: string;
}

export interface UserDTO {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  timezone: string;
  locale: string;
  hasAvatar: boolean;
  platformRole: PlatformRole | null;
  createdAt: ISODate;
}

export interface MembershipSummaryDTO {
  id: string;
  orgId: string;
  orgName: string;
  orgSlug: string;
  orgStatus: OrgStatus;
  orgTimezone: string;
  role: OrgRole;
  status: MembershipStatus;
  studentNumber: string | null;
}

export interface MeDTO {
  user: UserDTO;
  memberships: MembershipSummaryDTO[];
  csrfToken: string;
}

export interface SessionDTO {
  id: string;
  userAgent: string;
  ipPrefix: string;
  createdAt: ISODate;
  lastUsedAt: ISODate;
  expiresAt: ISODate;
  current: boolean;
}

export interface NotificationPreferencesDTO extends NotificationPreferences {
  effectiveReminderOffsetsMinutes: number[];
}

export interface OrgDTO {
  id: string;
  name: string;
  slug: string;
  status: OrgStatus;
  timezone: string;
  settings: OrgSettings;
  branding: { primaryColor: string | null };
  /** Only returned to organization administrators. */
  joinCode: string | null;
  createdAt: ISODate;
}

export interface MemberDTO {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  status: MembershipStatus;
  studentNumber: string | null;
  departmentId: string | null;
  joinedAt: ISODate;
  lastLoginAt: ISODate | null;
  userStatus: string;
}

export interface InvitationDTO {
  id: string;
  email: string;
  role: OrgRole;
  status: InvitationStatus;
  courseId: string | null;
  expiresAt: ISODate;
  createdAt: ISODate;
  invitedBy: PersonRef | null;
}

export interface InvitationPreviewDTO {
  orgName: string;
  role: OrgRole;
  email: string;
  expiresAt: ISODate;
  accountExists: boolean;
}

export interface DepartmentDTO {
  id: string;
  name: string;
  code: string;
  status: 'active' | 'archived';
  courseCount: number;
}

export interface CourseDTO {
  id: string;
  orgId: string;
  code: string;
  title: string;
  description: string;
  term: string;
  status: CourseStatus;
  departmentId: string | null;
  departmentName: string | null;
  instructors: PersonRef[];
  studentCount: number;
  myRole: EnrollmentRole | null;
  createdAt: ISODate;
}

export interface SectionDTO {
  id: string;
  courseId: string;
  name: string;
  status: 'active' | 'archived';
  studentCount: number;
}

export interface EnrollmentDTO {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: EnrollmentRole;
  status: EnrollmentStatus;
  sectionId: string | null;
  sectionName: string | null;
  studentNumber: string | null;
  enrolledAt: ISODate;
}

export interface RosterImportRowResult {
  line: number;
  email: string;
  name: string;
  role: EnrollmentRole;
  section: string;
  action: 'enroll' | 'invite' | 'skip_duplicate' | 'skip_enrolled' | 'error';
  errors: string[];
}

export interface RosterImportPreviewDTO {
  rows: RosterImportRowResult[];
  summary: { total: number; enroll: number; invite: number; skipped: number; errors: number };
  /** Hash of the previewed content; commit must present the same hash. */
  contentHash: string;
}

export interface FileDTO {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  scanStatus: FileScanStatus;
  createdAt: ISODate;
  downloadPath: string;
}

export interface MySubmissionSummary {
  submissionState: SubmissionState | null;
  displayStatus: SubmissionDisplayStatus;
  effectiveDueAt: ISODate;
  extensionDueAt: ISODate | null;
  cutoffAt: ISODate | null;
  acceptingSubmissions: boolean;
  isLate: boolean;
  attemptCount: number;
  gradeVisible: boolean;
  finalPoints: number | null;
  pendingExtensionRequest: boolean;
}

export interface AssignmentDTO {
  id: string;
  orgId: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  title: string;
  description: string;
  instructions: string;
  type: AssignmentType;
  learningObjectives: string[];
  maxPoints: number;
  rubricId: string | null;
  status: AssignmentStatus;
  publishAt: ISODate | null;
  publishedAt: ISODate | null;
  availableFrom: ISODate | null;
  dueAt: ISODate;
  availableUntil: ISODate | null;
  timezone: string;
  gracePeriodMinutes: number;
  latePolicy: LatePolicy;
  resubmission: ResubmissionPolicy;
  submissionMethods: { text: boolean; file: boolean; url: boolean };
  fileRules: { allowedExtensions: string[]; maxFiles: number; maxFileSizeMb: number };
  sectionIds: string[];
  extensionsAllowed: boolean;
  gradeRelease: GradeReleaseMode;
  gradesReleasedAt: ISODate | null;
  attachments: FileDTO[];
  createdBy: PersonRef | null;
  createdAt: ISODate;
  updatedAt: ISODate;
  rev: number;
  /** Present for students; instructors receive null. */
  my: MySubmissionSummary | null;
  /** Present for instructors on detail requests. */
  canManage: boolean;
  /** The viewer teaches the course: may open submissions and grade (administrators manage but do not grade). */
  canGrade: boolean;
}

export interface AssignmentChangeDTO {
  id: string;
  actor: PersonRef | null;
  kind: 'created' | 'updated' | 'status';
  changedFields: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  note: string | null;
  createdAt: ISODate;
}

export interface AssignmentStatsDTO {
  targeted: number;
  submitted: number;
  onTime: number;
  late: number;
  returned: number;
  gradedDraft: number;
  gradedPublished: number;
  notSubmitted: number;
  missing: number;
  averagePercent: number | null;
  distribution: { bucket: string; count: number }[];
}

export interface SubmissionVersionDTO {
  id: string;
  attemptNumber: number;
  text: string | null;
  url: string | null;
  files: FileDTO[];
  submittedAt: ISODate;
  isLate: boolean;
  lateByMinutes: number;
  effectiveDueAt: ISODate;
  receiptCode: string;
}

export interface GradeContentDTO {
  rawPoints: number;
  latePenaltyPoints: number;
  finalPoints: number;
  percentage: number;
  maxPoints: number;
  feedback: string;
  rubricScores: RubricScore[];
  rubric: RubricCriterion[] | null;
  versionId: string | null;
}

export interface TeacherGradeContentDTO extends GradeContentDTO {
  privateNotes: string;
}

/** What a student sees once a grade is released. Never includes private notes or drafts. */
export interface StudentGradeDTO extends GradeContentDTO {
  publishedAt: ISODate;
  gradedBy: PersonRef | null;
}

export interface TeacherGradeDTO {
  id: string;
  rev: number;
  draft: TeacherGradeContentDTO | null;
  published: TeacherGradeContentDTO | null;
  publishedAt: ISODate | null;
  hasUnpublishedChanges: boolean;
  visibleToStudent: boolean;
}

export interface MySubmissionDTO {
  id: string | null;
  assignmentId: string;
  state: SubmissionState | null;
  displayStatus: SubmissionDisplayStatus;
  rev: number;
  draft: { text: string | null; url: string | null; files: FileDTO[]; savedAt: ISODate | null };
  attemptCount: number;
  currentVersion: SubmissionVersionDTO | null;
  returnFeedback: string | null;
  grade: StudentGradeDTO | null;
  timing: {
    effectiveDueAt: ISODate;
    lateThreshold: ISODate;
    cutoffAt: ISODate | null;
    accepting: boolean;
    blockReason: string | null;
    wouldBeLate: boolean;
    serverTime: ISODate;
  };
  canSubmit: boolean;
  submitBlockedMessage: string | null;
  canWithdraw: boolean;
}

export interface SubmissionReceiptDTO {
  submissionId: string;
  versionId: string;
  receiptCode: string;
  attemptNumber: number;
  submittedAt: ISODate;
  isLate: boolean;
  assignmentTitle: string;
  courseCode: string;
  fileCount: number;
}

export interface InboxRowDTO {
  studentId: string;
  name: string;
  email: string;
  studentNumber: string | null;
  sectionName: string | null;
  submissionId: string | null;
  state: SubmissionState | null;
  displayStatus: SubmissionDisplayStatus;
  submittedAt: ISODate | null;
  isLate: boolean;
  attemptCount: number;
  gradeStatus: 'none' | 'draft' | 'published';
  finalPoints: number | null;
  extensionDueAt: ISODate | null;
}

export interface TeacherSubmissionDTO {
  id: string;
  assignment: Pick<
    AssignmentDTO,
    | 'id'
    | 'title'
    | 'courseId'
    | 'courseCode'
    | 'maxPoints'
    | 'rubricId'
    | 'dueAt'
    | 'latePolicy'
    | 'gradeRelease'
  >;
  student: { id: string; name: string; email: string; studentNumber: string | null };
  state: SubmissionState;
  displayStatus: SubmissionDisplayStatus;
  rev: number;
  attemptCount: number;
  returnFeedback: string | null;
  versions: SubmissionVersionDTO[];
  grade: TeacherGradeDTO | null;
  rubric: RubricCriterion[] | null;
  extensionDueAt: ISODate | null;
  /** Adjacent submissions for keyboard navigation in the grading workspace. */
  previousId: string | null;
  nextId: string | null;
}

export interface GradeHistoryDTO {
  id: string;
  action: 'publish' | 'correct' | 'return';
  actor: PersonRef | null;
  previousFinalPoints: number | null;
  newFinalPoints: number | null;
  reason: string | null;
  versionId: string | null;
  createdAt: ISODate;
}

export interface RubricDTO {
  id: string;
  title: string;
  description: string;
  courseId: string | null;
  criteria: RubricCriterion[];
  totalPoints: number;
  status: 'active' | 'archived';
  owner: PersonRef | null;
  rev: number;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface ExtensionRequestDTO {
  id: string;
  assignmentId: string;
  assignmentTitle: string;
  courseId: string;
  courseCode: string;
  student: { id: string; name: string; email: string };
  reason: string;
  requestedDueAt: ISODate;
  originalDueAt: ISODate;
  status: ExtensionStatus;
  approvedDueAt: ISODate | null;
  decisionNote: string | null;
  decidedBy: PersonRef | null;
  decidedAt: ISODate | null;
  createdAt: ISODate;
}

export interface NotificationDTO {
  id: string;
  orgId: string | null;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  readAt: ISODate | null;
  createdAt: ISODate;
}

export interface AnnouncementDTO {
  id: string;
  orgId: string;
  courseId: string | null;
  courseCode: string | null;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  status: AnnouncementStatus;
  publishAt: ISODate | null;
  publishedAt: ISODate | null;
  expiresAt: ISODate | null;
  requireAck: boolean;
  sendEmail: boolean;
  author: PersonRef | null;
  readAt: ISODate | null;
  acknowledgedAt: ISODate | null;
  canManage: boolean;
  rev: number;
  createdAt: ISODate;
  updatedAt: ISODate;
  stats: { read: number; acknowledged: number } | null;
}

export interface CalendarEventDTO {
  id: string;
  assignmentId: string;
  title: string;
  courseId: string;
  courseCode: string;
  type: AssignmentType;
  dueAt: ISODate;
  isExtended: boolean;
  status: SubmissionDisplayStatus | AssignmentStatus;
}

export interface AssignmentListItemDTO {
  id: string;
  title: string;
  courseId: string;
  courseCode: string;
  dueAt: ISODate;
  effectiveDueAt: ISODate;
  status: AssignmentStatus;
  displayStatus: SubmissionDisplayStatus | null;
  maxPoints: number;
  finalPoints: number | null;
}

export interface StudentDashboardDTO {
  activeCourses: number;
  counts: {
    dueSoon: number;
    pending: number;
    submitted: number;
    overdue: number;
    returned: number;
    graded: number;
  };
  upcoming: AssignmentListItemDTO[];
  overdue: AssignmentListItemDTO[];
  recentlyGraded: AssignmentListItemDTO[];
  announcements: AnnouncementDTO[];
  progressByCourse: {
    courseId: string;
    code: string;
    title: string;
    total: number;
    completed: number;
    averagePercent: number | null;
  }[];
}

export interface TeacherDashboardDTO {
  coursesTaught: number;
  assignments: { active: number; published: number; scheduled: number; draft: number };
  pendingGrading: number;
  lateSubmissions: number;
  missingSubmissions: number;
  pendingExtensions: number;
  upcomingDeadlines: (AssignmentListItemDTO & { submitted: number; targeted: number })[];
  recentSubmissions: {
    submissionId: string;
    assignmentId: string;
    assignmentTitle: string;
    courseCode: string;
    studentName: string;
    submittedAt: ISODate;
    isLate: boolean;
  }[];
  gradeRelease: {
    assignmentId: string;
    title: string;
    courseCode: string;
    draftGrades: number;
    publishedGrades: number;
    held: boolean;
  }[];
  courseCompletion: {
    courseId: string;
    code: string;
    title: string;
    assignments: number;
    completionRate: number | null;
  }[];
}

export interface AdminDashboardDTO {
  members: {
    total: number;
    students: number;
    teachers: number;
    admins: number;
    pending: number;
    suspended: number;
  };
  courses: { active: number; archived: number };
  assignments: { draft: number; scheduled: number; published: number; closed: number };
  submissionsByDay: { date: string; count: number }[];
  invitations: { pending: number; expired: number; acceptedLast30Days: number };
  security: { failedLoginsLast24h: number; lockedAccounts: number; adminAccessEventsLast30Days: number };
}

export interface CourseReportDTO {
  course: Pick<CourseDTO, 'id' | 'code' | 'title' | 'term'>;
  studentCount: number;
  assignments: {
    id: string;
    title: string;
    dueAt: ISODate;
    status: AssignmentStatus;
    maxPoints: number;
    targeted: number;
    submitted: number;
    late: number;
    graded: number;
    averagePercent: number | null;
    completionRate: number | null;
  }[];
  students: {
    studentId: string;
    name: string;
    submitted: number;
    late: number;
    missing: number;
    averagePercent: number | null;
  }[];
}

export interface AuditLogDTO {
  id: string;
  action: string;
  actor: { id: string; name: string; email: string } | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  requestId: string | null;
  createdAt: ISODate;
}

export interface PlatformOrgDTO extends Omit<OrgDTO, 'joinCode'> {
  memberCount: number;
  courseCount: number;
}

export interface PlatformUserDTO {
  id: string;
  name: string;
  email: string;
  status: string;
  platformRole: PlatformRole | null;
  emailVerified: boolean;
  membershipCount: number;
  createdAt: ISODate;
  lastLoginAt: ISODate | null;
}

export interface HealthDTO {
  status: 'ok' | 'degraded' | 'unavailable';
  checks: Record<string, { status: 'ok' | 'degraded' | 'unavailable' | 'disabled'; detail?: string }>;
  version: string;
  uptimeSeconds: number;
}
