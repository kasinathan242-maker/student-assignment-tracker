import {
  SUBMISSION_BLOCK_MESSAGES,
  SUBMIT_INELIGIBLE_MESSAGES,
  canSubmit,
  canWithdraw,
  displayStatus,
  evaluateSubmissionTiming,
  type GradeContentDTO,
  type MySubmissionDTO,
  type StudentGradeDTO,
  type SubmissionVersionDTO,
  type TeacherGradeContentDTO,
} from '@sat/shared';
import {
  FileObject,
  Grade,
  Submission,
  SubmissionVersion,
  toId,
  type AssignmentDoc,
  type FileObjectDoc,
  type GradeContent,
  type GradeDoc,
  type SubmissionDoc,
  type SubmissionVersionDoc,
} from '../../models';
import { isGradeVisible } from '../../services/gradeVisibility';
import { loadFiles, loadPeople, personRef, type serializeFile } from '../common/serializers';
import { extensionDueAt } from '../assignments/service';

export function serializeVersion(
  v: SubmissionVersionDoc,
  files: Map<string, ReturnType<typeof serializeFile>>,
): SubmissionVersionDTO {
  return {
    id: v._id.toString(),
    attemptNumber: v.attemptNumber,
    text: v.text,
    url: v.url,
    // Version file metadata is immutable; the live file row supplies the download path and scan status.
    files: v.files.map(
      (f) =>
        files.get(f.fileId.toString()) ?? {
          id: f.fileId.toString(),
          name: f.name,
          size: f.size,
          mimeType: f.mimeType,
          scanStatus: 'pending',
          createdAt: v.submittedAt.toISOString(),
          downloadPath: `/api/v1/files/${f.fileId.toString()}/download`,
        },
    ),
    submittedAt: v.submittedAt.toISOString(),
    isLate: v.isLate,
    lateByMinutes: v.lateByMinutes,
    effectiveDueAt: v.effectiveDueAt.toISOString(),
    receiptCode: v.receiptCode,
  };
}

export async function loadVersions(submissionId: SubmissionDoc['_id']): Promise<SubmissionVersionDTO[]> {
  const versions = await SubmissionVersion.find({ submissionId })
    .sort({ attemptNumber: -1 })
    .limit(100)
    .lean<SubmissionVersionDoc[]>();
  const files = await loadFiles(versions.flatMap((v) => v.files.map((f) => f.fileId)));
  return versions.map((v) => serializeVersion(v, files));
}

export function gradeContentDto(c: GradeContent): GradeContentDTO {
  return {
    rawPoints: c.rawPoints,
    latePenaltyPoints: c.latePenaltyPoints,
    finalPoints: c.finalPoints,
    percentage: c.maxPoints > 0 ? Math.round((c.finalPoints / c.maxPoints) * 10_000) / 100 : 0,
    maxPoints: c.maxPoints,
    feedback: c.feedback,
    rubricScores: c.rubricScores.map((s) => ({
      criterionId: s.criterionId,
      points: s.points,
      comment: s.comment ?? '',
    })),
    rubric: c.rubric,
    versionId: c.versionId?.toString() ?? null,
  };
}

export function teacherGradeContentDto(c: GradeContent | null): TeacherGradeContentDTO | null {
  return c ? { ...gradeContentDto(c), privateNotes: c.privateNotes } : null;
}

/** The student's view of a grade: only released, published content — never drafts or private notes. */
export async function studentGrade(
  grade: GradeDoc | null,
  assignment: AssignmentDoc,
): Promise<StudentGradeDTO | null> {
  if (!grade?.published || !isGradeVisible(grade, assignment)) return null;
  const people = await loadPeople([grade.published.gradedBy]);
  return {
    ...gradeContentDto(grade.published),
    publishedAt: (grade.publishedAt ?? grade.published.gradedAt).toISOString(),
    gradedBy: personRef(people, grade.published.gradedBy),
  };
}

export async function buildMySubmission(
  assignment: AssignmentDoc,
  studentId: string,
  now: Date,
): Promise<MySubmissionDTO> {
  const [sub, ext, grade] = await Promise.all([
    Submission.findOne({ assignmentId: assignment._id, studentId }).lean<SubmissionDoc>(),
    extensionDueAt(assignment._id, studentId),
    Grade.findOne({ assignmentId: assignment._id, studentId: toId(studentId) }).lean<GradeDoc>(),
  ]);
  const timing = evaluateSubmissionTiming(assignment, now, ext);
  const eligibility = canSubmit({
    state: sub?.state ?? null,
    attemptCount: sub?.attemptCount ?? 0,
    resubmission: assignment.resubmission,
    timing,
  });
  const draftFiles = await loadFiles(sub?.draft.fileIds ?? []);
  const versionDoc = sub?.currentVersionId
    ? await SubmissionVersion.findById(sub.currentVersionId).lean<SubmissionVersionDoc>()
    : null;
  const versionFiles = versionDoc ? await loadFiles(versionDoc.files.map((f) => f.fileId)) : new Map();
  const studentGradeDto = await studentGrade(grade, assignment);
  return {
    id: sub?._id.toString() ?? null,
    assignmentId: assignment._id.toString(),
    state: sub?.state ?? null,
    displayStatus: displayStatus({
      state: sub?.state ?? null,
      isLate: sub?.isLate ?? false,
      attemptCount: sub?.attemptCount ?? 0,
      gradeVisible: studentGradeDto != null,
      now,
      effectiveDueAt: timing.effectiveDueAt,
      stillAccepting: timing.allowed,
    }),
    rev: sub?.rev ?? 0,
    draft: {
      text: sub?.draft.text ?? null,
      url: sub?.draft.url ?? null,
      files: (sub?.draft.fileIds ?? [])
        .map((id) => draftFiles.get(id.toString()))
        .filter((f): f is NonNullable<typeof f> => Boolean(f)),
      savedAt: sub?.draft.savedAt?.toISOString() ?? null,
    },
    attemptCount: sub?.attemptCount ?? 0,
    currentVersion: versionDoc ? serializeVersion(versionDoc, versionFiles) : null,
    returnFeedback: sub?.state === 'returned' ? sub.returnFeedback : null,
    grade: studentGradeDto,
    timing: {
      effectiveDueAt: timing.effectiveDueAt.toISOString(),
      lateThreshold: timing.lateThreshold.toISOString(),
      cutoffAt: timing.cutoffAt?.toISOString() ?? null,
      accepting: timing.allowed,
      blockReason: timing.reason ? SUBMISSION_BLOCK_MESSAGES[timing.reason] : null,
      wouldBeLate: timing.isLate,
      serverTime: now.toISOString(),
    },
    canSubmit: eligibility.ok,
    submitBlockedMessage: eligibility.ok
      ? null
      : eligibility.reason === 'deadline' && timing.reason
        ? SUBMISSION_BLOCK_MESSAGES[timing.reason]
        : SUBMIT_INELIGIBLE_MESSAGES[eligibility.reason],
    canWithdraw: canWithdraw(sub?.state ?? null, timing.allowed),
  };
}

/** Files referenced by a draft must belong to this student and this assignment and not be infected. */
export async function loadOwnedSubmissionFiles(
  fileIds: string[] | SubmissionDoc['draft']['fileIds'],
  studentId: string,
  assignmentId: AssignmentDoc['_id'],
): Promise<FileObjectDoc[]> {
  if (fileIds.length === 0) return [];
  const files = await FileObject.find({
    _id: { $in: fileIds },
    ownerId: studentId,
    purpose: 'submission',
    assignmentId,
    status: { $ne: 'deleted' },
  }).lean<FileObjectDoc[]>();
  return files;
}
