import { model, Schema } from 'mongoose';
import {
  EXTENSION_STATUSES,
  LIMITS,
  SUBMISSION_STATES,
  type ExtensionStatus,
  type RubricCriterion,
  type RubricScore,
  type SubmissionState,
} from '@sat/shared';
import { baseOptions, ObjectId, type Id, type Timestamps } from './_common';

/* ───────────── submissions (one per student per assignment) ───────────── */

export interface SubmissionDoc extends Timestamps {
  _id: Id;
  orgId: Id;
  courseId: Id;
  assignmentId: Id;
  studentId: Id;
  state: SubmissionState;
  draft: { text: string | null; url: string | null; fileIds: Id[]; savedAt: Date | null };
  attemptCount: number;
  currentVersionId: Id | null;
  lastSubmittedAt: Date | null;
  isLate: boolean;
  returnFeedback: string | null;
  returnedAt: Date | null;
  withdrawnAt: Date | null;
  rev: number;
}

const submissionSchema = new Schema<SubmissionDoc>(
  {
    orgId: { type: ObjectId, required: true },
    courseId: { type: ObjectId, required: true },
    assignmentId: { type: ObjectId, required: true },
    studentId: { type: ObjectId, required: true },
    state: { type: String, enum: SUBMISSION_STATES, required: true },
    draft: {
      text: { type: String, default: null, maxlength: LIMITS.submissionText },
      url: { type: String, default: null, maxlength: LIMITS.url },
      fileIds: { type: [ObjectId], default: [] },
      savedAt: { type: Date, default: null },
    },
    attemptCount: { type: Number, default: 0 },
    currentVersionId: { type: ObjectId, default: null },
    lastSubmittedAt: { type: Date, default: null },
    isLate: { type: Boolean, default: false },
    returnFeedback: { type: String, default: null, maxlength: LIMITS.feedback },
    returnedAt: { type: Date, default: null },
    withdrawnAt: { type: Date, default: null },
    rev: { type: Number, default: 0 },
  },
  baseOptions<SubmissionDoc>('submissions'),
);
// The database, not application code, guarantees one submission record per student per assignment.
submissionSchema.index({ assignmentId: 1, studentId: 1 }, { unique: true });
submissionSchema.index({ orgId: 1, studentId: 1, state: 1 });
submissionSchema.index({ assignmentId: 1, state: 1, lastSubmittedAt: -1 });
submissionSchema.index({ courseId: 1, lastSubmittedAt: -1 });

export const Submission = model<SubmissionDoc>('Submission', submissionSchema);

/* ───────────── immutable submission versions ───────────── */

export interface VersionFile {
  fileId: Id;
  name: string;
  size: number;
  mimeType: string;
  sha256: string;
}

export interface SubmissionVersionDoc {
  _id: Id;
  orgId: Id;
  submissionId: Id;
  assignmentId: Id;
  studentId: Id;
  attemptNumber: number;
  text: string | null;
  url: string | null;
  files: VersionFile[];
  submittedAt: Date;
  isLate: boolean;
  lateByMinutes: number;
  effectiveDueAt: Date;
  receiptCode: string;
  idempotencyKey: string | null;
  createdAt: Date;
}

const versionSchema = new Schema<SubmissionVersionDoc>(
  {
    orgId: { type: ObjectId, required: true },
    submissionId: { type: ObjectId, required: true },
    assignmentId: { type: ObjectId, required: true },
    studentId: { type: ObjectId, required: true },
    attemptNumber: { type: Number, required: true, min: 1 },
    text: { type: String, default: null, maxlength: LIMITS.submissionText },
    url: { type: String, default: null, maxlength: LIMITS.url },
    files: [
      {
        _id: false,
        fileId: { type: ObjectId, required: true },
        name: { type: String, required: true },
        size: { type: Number, required: true },
        mimeType: { type: String, required: true },
        sha256: { type: String, required: true },
      },
    ],
    submittedAt: { type: Date, required: true },
    isLate: { type: Boolean, required: true },
    lateByMinutes: { type: Number, default: 0 },
    effectiveDueAt: { type: Date, required: true },
    receiptCode: { type: String, required: true },
    idempotencyKey: { type: String, default: null },
  },
  baseOptions<SubmissionVersionDoc>('submissionVersions', {
    timestamps: { createdAt: true, updatedAt: false },
  }),
);
versionSchema.index({ submissionId: 1, attemptNumber: 1 }, { unique: true });
versionSchema.index({ receiptCode: 1 }, { unique: true });
versionSchema.index({ 'files.fileId': 1 });

export const SubmissionVersion = model<SubmissionVersionDoc>('SubmissionVersion', versionSchema);

/* ───────────── grades (one per submission) + history ───────────── */

export interface GradeContent {
  rawPoints: number;
  latePenaltyPoints: number;
  finalPoints: number;
  maxPoints: number;
  feedback: string;
  privateNotes: string;
  rubricScores: RubricScore[];
  /** Snapshot of the rubric at grading time — later rubric edits never rewrite history. */
  rubric: RubricCriterion[] | null;
  versionId: Id | null;
  gradedBy: Id;
  gradedAt: Date;
}

export interface GradeDoc extends Timestamps {
  _id: Id;
  orgId: Id;
  courseId: Id;
  assignmentId: Id;
  submissionId: Id;
  studentId: Id;
  draft: GradeContent | null;
  published: GradeContent | null;
  publishedAt: Date | null;
  publishedBy: Id | null;
  rev: number;
}

const gradeContent = new Schema<GradeContent>(
  {
    rawPoints: { type: Number, required: true },
    latePenaltyPoints: { type: Number, default: 0 },
    finalPoints: { type: Number, required: true },
    maxPoints: { type: Number, required: true },
    feedback: { type: String, default: '', maxlength: LIMITS.feedback },
    privateNotes: { type: String, default: '', maxlength: LIMITS.privateNotes },
    rubricScores: [
      {
        _id: false,
        criterionId: { type: String, required: true },
        points: { type: Number, required: true },
        comment: { type: String, default: '' },
      },
    ],
    rubric: { type: Schema.Types.Mixed, default: null },
    versionId: { type: ObjectId, default: null },
    gradedBy: { type: ObjectId, required: true },
    gradedAt: { type: Date, required: true },
  },
  { _id: false },
);

const gradeSchema = new Schema<GradeDoc>(
  {
    orgId: { type: ObjectId, required: true },
    courseId: { type: ObjectId, required: true },
    assignmentId: { type: ObjectId, required: true },
    submissionId: { type: ObjectId, required: true },
    studentId: { type: ObjectId, required: true },
    draft: { type: gradeContent, default: null },
    published: { type: gradeContent, default: null },
    publishedAt: { type: Date, default: null },
    publishedBy: { type: ObjectId, default: null },
    rev: { type: Number, default: 0 },
  },
  baseOptions<GradeDoc>('gradingRecords'),
);
gradeSchema.index({ submissionId: 1 }, { unique: true });
gradeSchema.index({ assignmentId: 1, studentId: 1 });
gradeSchema.index({ orgId: 1, studentId: 1, publishedAt: -1 });

export const Grade = model<GradeDoc>('Grade', gradeSchema);

export interface GradeHistoryDoc {
  _id: Id;
  orgId: Id;
  gradeId: Id | null;
  submissionId: Id;
  assignmentId: Id;
  action: 'publish' | 'correct' | 'return';
  actorId: Id;
  previousFinalPoints: number | null;
  newFinalPoints: number | null;
  reason: string | null;
  versionId: Id | null;
  createdAt: Date;
}

const gradeHistorySchema = new Schema<GradeHistoryDoc>(
  {
    orgId: { type: ObjectId, required: true },
    gradeId: { type: ObjectId, default: null },
    submissionId: { type: ObjectId, required: true },
    assignmentId: { type: ObjectId, required: true },
    action: { type: String, enum: ['publish', 'correct', 'return'], required: true },
    actorId: { type: ObjectId, required: true },
    previousFinalPoints: { type: Number, default: null },
    newFinalPoints: { type: Number, default: null },
    reason: { type: String, default: null, maxlength: LIMITS.correctionReason },
    versionId: { type: ObjectId, default: null },
  },
  baseOptions<GradeHistoryDoc>('gradeHistory', { timestamps: { createdAt: true, updatedAt: false } }),
);
gradeHistorySchema.index({ submissionId: 1, createdAt: -1 });

export const GradeHistory = model<GradeHistoryDoc>('GradeHistory', gradeHistorySchema);

/* ───────────── extension requests ───────────── */

export interface ExtensionRequestDoc extends Timestamps {
  _id: Id;
  orgId: Id;
  courseId: Id;
  assignmentId: Id;
  studentId: Id;
  reason: string;
  requestedDueAt: Date;
  originalDueAt: Date;
  status: ExtensionStatus;
  approvedDueAt: Date | null;
  decisionNote: string | null;
  decidedBy: Id | null;
  decidedAt: Date | null;
  /** True when an instructor granted the extension directly without a student request. */
  granted: boolean;
}

const extensionSchema = new Schema<ExtensionRequestDoc>(
  {
    orgId: { type: ObjectId, required: true },
    courseId: { type: ObjectId, required: true },
    assignmentId: { type: ObjectId, required: true },
    studentId: { type: ObjectId, required: true },
    reason: { type: String, required: true, maxlength: LIMITS.extensionReason },
    requestedDueAt: { type: Date, required: true },
    originalDueAt: { type: Date, required: true },
    status: { type: String, enum: EXTENSION_STATUSES, default: 'pending' },
    approvedDueAt: { type: Date, default: null },
    decisionNote: { type: String, default: null, maxlength: LIMITS.decisionNote },
    decidedBy: { type: ObjectId, default: null },
    decidedAt: { type: Date, default: null },
    granted: { type: Boolean, default: false },
  },
  baseOptions<ExtensionRequestDoc>('extensionRequests'),
);
// One open request per student per assignment.
extensionSchema.index(
  { assignmentId: 1, studentId: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } },
);
extensionSchema.index({ assignmentId: 1, studentId: 1, status: 1, decidedAt: -1 });
extensionSchema.index({ orgId: 1, courseId: 1, status: 1, createdAt: -1 });

export const ExtensionRequest = model<ExtensionRequestDoc>('ExtensionRequest', extensionSchema);
