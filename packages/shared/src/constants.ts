/**
 * Field and payload limits. The API validates against these and the web app uses them for
 * client-side hints, so both sides always agree.
 */
export const LIMITS = {
  name: 120,
  email: 254,
  passwordMin: 12,
  /** Argon2 has no practical input limit, but unbounded input is a DoS vector. Measured in characters. */
  passwordMax: 256,
  slug: 48,
  orgName: 120,
  courseCode: 32,
  courseTitle: 160,
  courseDescription: 5_000,
  term: 64,
  departmentName: 120,
  departmentCode: 24,
  sectionName: 80,
  assignmentTitle: 200,
  assignmentDescription: 10_000,
  assignmentInstructions: 20_000,
  learningObjectives: 20,
  learningObjectiveLength: 300,
  maxPoints: 10_000,
  allowedExtensions: 30,
  maxFilesPerSubmission: 20,
  maxFileSizeMb: 100,
  assignmentAttachments: 20,
  submissionText: 100_000,
  url: 2_048,
  feedback: 20_000,
  privateNotes: 10_000,
  rubricTitle: 160,
  rubricCriteria: 50,
  rubricCriterionTitle: 200,
  rubricCriterionDescription: 2_000,
  rubricLevels: 10,
  extensionReason: 2_000,
  decisionNote: 2_000,
  announcementTitle: 200,
  announcementBody: 20_000,
  correctionReason: 1_000,
  studentNumber: 64,
  joinCode: 32,
  csvImportBytes: 1_000_000,
  csvImportRows: 2_000,
  pageSizeDefault: 25,
  pageSizeMax: 100,
  searchQuery: 120,
  idempotencyKey: 128,
  avatarBytes: 2 * 1024 * 1024,
} as const;

/** Default reminder offsets (minutes before the effective deadline). Overridable per organization. */
export const DEFAULT_REMINDER_OFFSETS_MINUTES = [24 * 60, 60] as const;

export const AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Extensions an instructor may allow on submissions. Executables and active content are never allowed. */
export const ALLOWED_UPLOAD_EXTENSIONS = [
  'pdf',
  'doc',
  'docx',
  'odt',
  'rtf',
  'txt',
  'md',
  'csv',
  'xls',
  'xlsx',
  'ods',
  'ppt',
  'pptx',
  'odp',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'zip',
  'py',
  'java',
  'c',
  'cpp',
  'h',
  'js',
  'ts',
  'json',
  'ipynb',
  'mp3',
  'mp4',
] as const;
export type AllowedUploadExtension = (typeof ALLOWED_UPLOAD_EXTENSIONS)[number];

export const DEFAULT_SUBMISSION_EXTENSIONS: AllowedUploadExtension[] = ['pdf', 'docx', 'txt', 'zip'];

export const CSRF_HEADER = 'x-csrf-token';
export const IDEMPOTENCY_HEADER = 'idempotency-key';
