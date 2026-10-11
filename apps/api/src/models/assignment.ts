import { model, Schema } from 'mongoose';
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_TYPES,
  FILE_PURPOSES,
  FILE_SCAN_STATUSES,
  GRADE_RELEASE_MODES,
  LATE_POLICY_MODES,
  LIMITS,
  type AssignmentStatus,
  type AssignmentType,
  type FilePurpose,
  type FileScanStatus,
  type GradeReleaseMode,
  type LatePolicy,
  type ResubmissionPolicy,
  type RubricCriterion,
} from '@sat/shared';
import { baseOptions, ObjectId, type Id, type Timestamps } from './_common';

/* ───────────── assignments ───────────── */

export interface AssignmentDoc extends Timestamps {
  _id: Id;
  orgId: Id;
  courseId: Id;
  createdBy: Id;
  title: string;
  description: string;
  instructions: string;
  type: AssignmentType;
  learningObjectives: string[];
  maxPoints: number;
  rubricId: Id | null;
  status: AssignmentStatus;
  publishAt: Date | null;
  publishedAt: Date | null;
  closedAt: Date | null;
  archivedAt: Date | null;
  availableFrom: Date | null;
  dueAt: Date;
  availableUntil: Date | null;
  timezone: string;
  gracePeriodMinutes: number;
  latePolicy: LatePolicy;
  resubmission: ResubmissionPolicy;
  submissionMethods: { text: boolean; file: boolean; url: boolean };
  fileRules: { allowedExtensions: string[]; maxFiles: number; maxFileSizeMb: number };
  sectionIds: Id[];
  extensionsAllowed: boolean;
  gradeRelease: GradeReleaseMode;
  gradesReleasedAt: Date | null;
  attachmentIds: Id[];
  /** Optimistic-concurrency revision; every update must match and increment it. */
  rev: number;
}

const assignmentSchema = new Schema<AssignmentDoc>(
  {
    orgId: { type: ObjectId, required: true },
    courseId: { type: ObjectId, required: true },
    createdBy: { type: ObjectId, required: true },
    title: { type: String, required: true, trim: true, maxlength: LIMITS.assignmentTitle },
    description: { type: String, default: '', maxlength: LIMITS.assignmentDescription },
    instructions: { type: String, default: '', maxlength: LIMITS.assignmentInstructions },
    type: { type: String, enum: ASSIGNMENT_TYPES, required: true },
    learningObjectives: {
      type: [{ type: String, maxlength: LIMITS.learningObjectiveLength }],
      default: [],
      validate: [(v: string[]) => v.length <= LIMITS.learningObjectives, 'Too many learning objectives'],
    },
    maxPoints: { type: Number, required: true, min: 0, max: LIMITS.maxPoints },
    rubricId: { type: ObjectId, default: null },
    status: { type: String, enum: ASSIGNMENT_STATUSES, default: 'draft', required: true },
    publishAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
    availableFrom: { type: Date, default: null },
    dueAt: { type: Date, required: true },
    availableUntil: { type: Date, default: null },
    timezone: { type: String, required: true, maxlength: 64 },
    gracePeriodMinutes: { type: Number, default: 0, min: 0, max: 1440 },
    latePolicy: {
      mode: { type: String, enum: LATE_POLICY_MODES, required: true },
      penaltyPercentPerDay: { type: Number, default: 0, min: 0, max: 100 },
      maxLateDays: { type: Number, default: null },
    },
    resubmission: {
      allowed: { type: Boolean, default: false },
      maxAttempts: { type: Number, default: null },
    },
    submissionMethods: {
      text: { type: Boolean, default: false },
      file: { type: Boolean, default: true },
      url: { type: Boolean, default: false },
    },
    fileRules: {
      allowedExtensions: { type: [{ type: String, enum: ALLOWED_UPLOAD_EXTENSIONS }], default: [] },
      maxFiles: { type: Number, default: 1, min: 1, max: LIMITS.maxFilesPerSubmission },
      maxFileSizeMb: { type: Number, default: 10, min: 1, max: LIMITS.maxFileSizeMb },
    },
    sectionIds: { type: [ObjectId], default: [] },
    extensionsAllowed: { type: Boolean, default: false },
    gradeRelease: { type: String, enum: GRADE_RELEASE_MODES, default: 'immediate' },
    gradesReleasedAt: { type: Date, default: null },
    attachmentIds: { type: [ObjectId], default: [] },
    rev: { type: Number, default: 0 },
  },
  baseOptions<AssignmentDoc>('assignments'),
);
assignmentSchema.index({ orgId: 1, courseId: 1, status: 1, dueAt: 1 });
assignmentSchema.index({ orgId: 1, status: 1, dueAt: 1 });
assignmentSchema.index({ status: 1, publishAt: 1 }, { partialFilterExpression: { status: 'scheduled' } });
assignmentSchema.index(
  { status: 1, availableUntil: 1 },
  { partialFilterExpression: { status: 'published' } },
);

export const Assignment = model<AssignmentDoc>('Assignment', assignmentSchema);

/* ───────────── assignment change history ───────────── */

export interface AssignmentChangeDoc {
  _id: Id;
  orgId: Id;
  assignmentId: Id;
  actorId: Id | null;
  kind: 'created' | 'updated' | 'status';
  changedFields: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  material: boolean;
  note: string | null;
  createdAt: Date;
}

const assignmentChangeSchema = new Schema<AssignmentChangeDoc>(
  {
    orgId: { type: ObjectId, required: true },
    assignmentId: { type: ObjectId, required: true },
    actorId: { type: ObjectId, default: null },
    kind: { type: String, enum: ['created', 'updated', 'status'], required: true },
    changedFields: { type: [String], default: [] },
    before: { type: Schema.Types.Mixed, default: {} },
    after: { type: Schema.Types.Mixed, default: {} },
    material: { type: Boolean, default: false },
    note: { type: String, default: null, maxlength: LIMITS.correctionReason },
  },
  baseOptions<AssignmentChangeDoc>('assignmentChanges', {
    timestamps: { createdAt: true, updatedAt: false },
  }),
);
assignmentChangeSchema.index({ assignmentId: 1, createdAt: -1 });

export const AssignmentChange = model<AssignmentChangeDoc>('AssignmentChange', assignmentChangeSchema);

/* ───────────── rubrics ───────────── */

export interface RubricDoc extends Timestamps {
  _id: Id;
  orgId: Id;
  ownerId: Id;
  courseId: Id | null;
  title: string;
  description: string;
  criteria: RubricCriterion[];
  status: 'active' | 'archived';
  rev: number;
}

const rubricSchema = new Schema<RubricDoc>(
  {
    orgId: { type: ObjectId, required: true },
    ownerId: { type: ObjectId, required: true },
    courseId: { type: ObjectId, default: null },
    title: { type: String, required: true, trim: true, maxlength: LIMITS.rubricTitle },
    description: { type: String, default: '', maxlength: LIMITS.rubricCriterionDescription },
    criteria: {
      type: [
        {
          _id: false,
          id: { type: String, required: true },
          title: { type: String, required: true, maxlength: LIMITS.rubricCriterionTitle },
          description: { type: String, default: '', maxlength: LIMITS.rubricCriterionDescription },
          maxPoints: { type: Number, required: true, min: 0 },
          levels: [
            {
              _id: false,
              title: { type: String, required: true, maxlength: 80 },
              points: { type: Number, required: true, min: 0 },
              description: { type: String, default: '' },
            },
          ],
        },
      ],
      default: [],
    },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    rev: { type: Number, default: 0 },
  },
  baseOptions<RubricDoc>('rubrics'),
);
rubricSchema.index({ orgId: 1, ownerId: 1, status: 1 });
rubricSchema.index({ orgId: 1, courseId: 1, status: 1 });

export const Rubric = model<RubricDoc>('Rubric', rubricSchema);

/* ───────────── stored files (metadata; content lives in object storage) ───────────── */

export interface FileObjectDoc extends Timestamps {
  _id: Id;
  orgId: Id | null;
  ownerId: Id;
  purpose: FilePurpose;
  storageKey: string;
  originalName: string;
  extension: string;
  mimeType: string;
  size: number;
  sha256: string;
  status: 'pending' | 'attached' | 'deleted';
  scanStatus: FileScanStatus;
  /** Owning context, e.g. { type: 'submission', id } — used for authorization. */
  attachedTo: { type: 'submission' | 'submissionVersion' | 'assignment' | 'user'; id: Id } | null;
  assignmentId: Id | null;
  deletedAt: Date | null;
}

const fileSchema = new Schema<FileObjectDoc>(
  {
    orgId: { type: ObjectId, default: null },
    ownerId: { type: ObjectId, required: true },
    purpose: { type: String, enum: FILE_PURPOSES, required: true },
    storageKey: { type: String, required: true },
    originalName: { type: String, required: true, maxlength: 255 },
    extension: { type: String, required: true, maxlength: 16 },
    mimeType: { type: String, required: true, maxlength: 128 },
    size: { type: Number, required: true, min: 0 },
    sha256: { type: String, required: true },
    status: { type: String, enum: ['pending', 'attached', 'deleted'], default: 'pending' },
    scanStatus: { type: String, enum: FILE_SCAN_STATUSES, default: 'pending' },
    attachedTo: {
      type: { type: String, enum: ['submission', 'submissionVersion', 'assignment', 'user'] },
      id: { type: ObjectId },
    },
    assignmentId: { type: ObjectId, default: null },
    deletedAt: { type: Date, default: null },
  },
  baseOptions<FileObjectDoc>('files'),
);
fileSchema.index({ storageKey: 1 }, { unique: true });
fileSchema.index({ status: 1, createdAt: 1 });
fileSchema.index({ ownerId: 1, purpose: 1, status: 1 });
fileSchema.index({ scanStatus: 1, createdAt: 1 }, { partialFilterExpression: { scanStatus: 'pending' } });

export const FileObject = model<FileObjectDoc>('FileObject', fileSchema);
