import { Router } from 'express';
import {
  SUBMISSION_BLOCK_MESSAGES,
  SUBMIT_INELIGIBLE_MESSAGES,
  canEditDraft,
  canSubmit,
  canWithdraw,
  evaluateSubmissionTiming,
  saveDraftSchema,
  submitSchema,
  type SubmissionReceiptDTO,
} from '@sat/shared';
import { isDuplicateKeyError, withTransaction } from '../../db/connection';
import { receiptCode } from '../../lib/crypto';
import { errors } from '../../lib/errors';
import { P, route } from '../../lib/route';
import { idempotent } from '../../middleware/idempotency';
import { limits } from '../../middleware/rateLimit';
import {
  FileObject,
  Submission,
  SubmissionVersion,
  toId,
  type FileObjectDoc,
  type SubmissionDoc,
} from '../../models';
import { actor, requireAssignmentStudent } from '../../services/access';
import { audit } from '../../services/audit';
import { deleteStoredFile, singleUpload, storeUpload } from '../../services/files';
import { enqueue } from '../../services/outbox';
import { serializeFile } from '../common/serializers';
import { extensionDueAt } from '../assignments/service';
import { buildMySubmission, loadOwnedSubmissionFiles, loadVersions } from './service';

const tags = ['Submissions (student)'];

export function submissionRoutes(): Router {
  const r = Router();
  const base = '/orgs/:orgId/assignments/:assignmentId/my-submission';

  route(r, {
    method: 'get',
    path: base,
    summary: 'My submission, draft, timing and released grade for an assignment',
    tags,
    access: 'org',
    params: P.orgAssignment,
    handler: async ({ req, params }) => {
      const a = actor(req);
      const { assignment } = await requireAssignmentStudent(a, params.assignmentId);
      return buildMySubmission(assignment, a.userId, req.receivedAt);
    },
  });

  route(r, {
    method: 'put',
    path: `${base}/draft`,
    summary: 'Save (autosave) my draft — never counts as a submission',
    tags,
    access: 'org',
    params: P.orgAssignment,
    body: saveDraftSchema,
    handler: async ({ req, params, body }) => {
      const a = actor(req);
      const { assignment } = await requireAssignmentStudent(a, params.assignmentId);
      const existing = await Submission.findOne({
        assignmentId: assignment._id,
        studentId: a.userId,
      }).lean<SubmissionDoc>();
      if (!canEditDraft(existing?.state ?? null))
        throw errors.conflict(
          'Graded work cannot be edited unless your instructor returns it.',
          'already_graded',
        );
      if (existing && body.expectedRev !== existing.rev) throw errors.staleRevision();

      const fields: Record<string, string[]> = {};
      if (body.text && !assignment.submissionMethods.text)
        fields.text = ['Written responses are not accepted for this assignment.'];
      if (body.url && !assignment.submissionMethods.url)
        fields.url = ['Links are not accepted for this assignment.'];
      if (body.fileIds?.length && !assignment.submissionMethods.file)
        fields.fileIds = ['Files are not accepted for this assignment.'];
      if (body.fileIds && body.fileIds.length > assignment.fileRules.maxFiles)
        fields.fileIds = [`Attach at most ${assignment.fileRules.maxFiles} file(s).`];
      if (Object.keys(fields).length)
        throw errors.validation('This submission includes content the assignment does not accept.', fields);

      let fileIds = existing?.draft.fileIds ?? [];
      if (body.fileIds) {
        const unique = [...new Set(body.fileIds)];
        const owned = await loadOwnedSubmissionFiles(unique, a.userId, assignment._id);
        if (owned.length !== unique.length)
          throw errors.validation('One or more files are not available.', { fileIds: ['Unknown file'] });
        fileIds = unique.map(toId);
      }
      const draft = {
        text: body.text !== undefined ? body.text || null : (existing?.draft.text ?? null),
        url: body.url !== undefined ? body.url || null : (existing?.draft.url ?? null),
        fileIds,
        savedAt: req.receivedAt,
      };

      if (!existing) {
        try {
          await Submission.create({
            orgId: a.orgId,
            courseId: assignment.courseId,
            assignmentId: assignment._id,
            studentId: a.userId,
            state: 'draft',
            draft,
          });
        } catch (err) {
          if (isDuplicateKeyError(err)) throw errors.staleRevision(); // created concurrently (e.g. another tab)
          throw err;
        }
      } else {
        const state = existing.state === 'withdrawn' ? 'draft' : existing.state;
        const updated = await Submission.updateOne(
          { _id: existing._id, rev: existing.rev },
          { $set: { draft, state }, $inc: { rev: 1 } },
        );
        if (updated.modifiedCount !== 1) throw errors.staleRevision();
      }
      return buildMySubmission(assignment, a.userId, req.receivedAt);
    },
  });

  route(r, {
    method: 'post',
    path: `${base}/files`,
    summary: 'Upload a file for my draft (type and size limits come from the assignment)',
    tags,
    access: 'org',
    requestContentType: 'multipart/form-data',
    params: P.orgAssignment,
    middleware: [limits.upload(), singleUpload()],
    handler: async ({ req, params }) => {
      const a = actor(req);
      const { assignment } = await requireAssignmentStudent(a, params.assignmentId);
      if (!assignment.submissionMethods.file)
        throw errors.validation(
          'Files are not accepted for this assignment.',
          undefined,
          'files_not_accepted',
        );
      const timing = evaluateSubmissionTiming(
        assignment,
        req.receivedAt,
        await extensionDueAt(assignment._id, a.userId),
      );
      if (!timing.allowed && timing.reason)
        throw errors.conflict(SUBMISSION_BLOCK_MESSAGES[timing.reason], 'submissions_closed');
      // Cap abandoned uploads per student per assignment.
      const pending = await FileObject.countDocuments({
        ownerId: a.userId,
        assignmentId: assignment._id,
        purpose: 'submission',
        status: 'pending',
      });
      if (pending >= assignment.fileRules.maxFiles * 3 + 5)
        throw errors.rateLimited('Too many unattached uploads. Remove unused files first.');
      const file = await storeUpload(req.file, {
        purpose: 'submission',
        orgId: a.orgId,
        ownerId: a.userId,
        allowedExtensions: assignment.fileRules.allowedExtensions,
        maxBytes: assignment.fileRules.maxFileSizeMb * 1024 * 1024,
        assignmentId: assignment._id,
      });
      await audit({
        req,
        action: 'submission.file_uploaded',
        targetType: 'assignment',
        targetId: assignment._id,
        metadata: { fileId: file._id, size: file.size, ext: file.extension },
      });
      return serializeFile(file);
    },
  });

  route(r, {
    method: 'delete',
    path: `${base}/files/:id`,
    summary: 'Remove a file from my draft (submitted versions keep their files)',
    tags,
    access: 'org',
    status: 204,
    params: P.orgAssignmentId,
    handler: async ({ req, params }) => {
      const a = actor(req);
      const { assignment } = await requireAssignmentStudent(a, params.assignmentId);
      const [file] = await loadOwnedSubmissionFiles([params.id], a.userId, assignment._id);
      if (!file) throw errors.notFound('File');
      await Submission.updateOne(
        { assignmentId: assignment._id, studentId: a.userId, state: { $ne: 'graded' } },
        { $pull: { 'draft.fileIds': file._id }, $inc: { rev: 1 } },
      );
      if (!(await SubmissionVersion.exists({ 'files.fileId': file._id }))) await deleteStoredFile(file);
    },
  });

  route(r, {
    method: 'post',
    path: `${base}/submit`,
    summary: 'Submit my draft as a new attempt. Send an Idempotency-Key header so network retries are safe.',
    description: 'The server receipt time decides lateness. Returns a receipt with a unique code.',
    tags,
    access: 'org',
    params: P.orgAssignment,
    body: submitSchema,
    middleware: [idempotent],
    handler: async ({ req, params, body }): Promise<SubmissionReceiptDTO> => {
      const a = actor(req);
      const { assignment, course } = await requireAssignmentStudent(a, params.assignmentId);
      const ext = await extensionDueAt(assignment._id, a.userId);
      const timing = evaluateSubmissionTiming(assignment, req.receivedAt, ext);
      const sub = await Submission.findOne({
        assignmentId: assignment._id,
        studentId: a.userId,
      }).lean<SubmissionDoc>();
      if (!sub) throw errors.conflict('Save your work before submitting.', 'no_draft');
      if (sub.rev !== body.expectedRev) throw errors.staleRevision();
      const eligibility = canSubmit({
        state: sub.state,
        attemptCount: sub.attemptCount,
        resubmission: assignment.resubmission,
        timing,
      });
      if (!eligibility.ok) {
        const message =
          eligibility.reason === 'deadline' && timing.reason
            ? SUBMISSION_BLOCK_MESSAGES[timing.reason]
            : SUBMIT_INELIGIBLE_MESSAGES[eligibility.reason];
        throw errors.conflict(
          message,
          eligibility.reason === 'deadline' ? 'submissions_closed' : eligibility.reason,
        );
      }

      const files: FileObjectDoc[] = await loadOwnedSubmissionFiles(
        sub.draft.fileIds,
        a.userId,
        assignment._id,
      );
      const fields: Record<string, string[]> = {};
      const text = assignment.submissionMethods.text
        ? sub.draft.text?.trim()
          ? sub.draft.text
          : null
        : null;
      const url = assignment.submissionMethods.url ? sub.draft.url : null;
      const usableFiles = assignment.submissionMethods.file ? files : [];
      if (files.length !== sub.draft.fileIds.length)
        fields.fileIds = ['A file is no longer available. Remove it and try again.'];
      if (usableFiles.some((f) => f.scanStatus === 'infected'))
        fields.fileIds = ['A file was flagged by the malware scanner.'];
      if (usableFiles.length > assignment.fileRules.maxFiles)
        fields.fileIds = [`Attach at most ${assignment.fileRules.maxFiles} file(s).`];
      if (!text && !url && usableFiles.length === 0) fields._root = ['Add your response before submitting.'];
      if (Object.keys(fields).length)
        throw errors.validation('Your submission is incomplete.', fields, 'submission_incomplete');

      const attemptNumber = sub.attemptCount + 1;
      const code = receiptCode();
      const result = await withTransaction(async (session) => {
        const [version] = await SubmissionVersion.create(
          [
            {
              orgId: a.orgId,
              submissionId: sub._id,
              assignmentId: assignment._id,
              studentId: a.userId,
              attemptNumber,
              text,
              url,
              files: usableFiles.map((f) => ({
                fileId: f._id,
                name: f.originalName,
                size: f.size,
                mimeType: f.mimeType,
                sha256: f.sha256,
              })),
              submittedAt: req.receivedAt,
              isLate: timing.isLate,
              lateByMinutes: timing.lateByMinutes,
              effectiveDueAt: timing.effectiveDueAt,
              receiptCode: code,
              idempotencyKey: req.get('idempotency-key') ?? null,
            },
          ],
          { session },
        );
        if (!version) throw new Error('version creation failed');
        const updated = await Submission.updateOne(
          { _id: sub._id, rev: sub.rev },
          {
            $set: {
              state: 'submitted',
              attemptCount: attemptNumber,
              currentVersionId: version._id,
              lastSubmittedAt: req.receivedAt,
              isLate: timing.isLate,
              withdrawnAt: null,
            },
            $inc: { rev: 1 },
          },
          { session },
        );
        if (updated.modifiedCount !== 1) throw errors.staleRevision();
        if (usableFiles.length) {
          await FileObject.updateMany(
            { _id: { $in: usableFiles.map((f) => f._id) } },
            { $set: { status: 'attached', attachedTo: { type: 'submission', id: sub._id } } },
            { session },
          );
        }
        await enqueue(
          'submission.submitted',
          { submissionId: sub._id.toString(), versionId: version._id.toString() },
          { session, dedupeKey: `submission.submitted:${version._id.toString()}` },
        );
        return version;
      });
      await audit({
        req,
        action: attemptNumber > 1 ? 'submission.resubmitted' : 'submission.submitted',
        targetType: 'submission',
        targetId: sub._id,
        metadata: { attemptNumber, isLate: timing.isLate, receiptCode: code },
      });
      return {
        submissionId: sub._id.toString(),
        versionId: result._id.toString(),
        receiptCode: code,
        attemptNumber,
        submittedAt: req.receivedAt.toISOString(),
        isLate: timing.isLate,
        assignmentTitle: assignment.title,
        courseCode: course.code,
        fileCount: usableFiles.length,
      };
    },
  });

  route(r, {
    method: 'post',
    path: `${base}/withdraw`,
    summary: 'Withdraw my submission before the deadline (the draft is kept)',
    tags,
    access: 'org',
    status: 200,
    params: P.orgAssignment,
    body: submitSchema,
    handler: async ({ req, params, body }) => {
      const a = actor(req);
      const { assignment } = await requireAssignmentStudent(a, params.assignmentId);
      const sub = await Submission.findOne({
        assignmentId: assignment._id,
        studentId: a.userId,
      }).lean<SubmissionDoc>();
      if (!sub) throw errors.notFound('Submission');
      if (sub.rev !== body.expectedRev) throw errors.staleRevision();
      const timing = evaluateSubmissionTiming(
        assignment,
        req.receivedAt,
        await extensionDueAt(assignment._id, a.userId),
      );
      if (!canWithdraw(sub.state, timing.allowed))
        throw errors.conflict('This submission can no longer be withdrawn.', 'cannot_withdraw');
      const updated = await Submission.updateOne(
        { _id: sub._id, rev: sub.rev, state: 'submitted' },
        { $set: { state: 'withdrawn', withdrawnAt: req.receivedAt }, $inc: { rev: 1 } },
      );
      if (updated.modifiedCount !== 1) throw errors.staleRevision();
      await audit({ req, action: 'submission.withdrawn', targetType: 'submission', targetId: sub._id });
      return buildMySubmission(assignment, a.userId, req.receivedAt);
    },
  });

  route(r, {
    method: 'get',
    path: `${base}/versions`,
    summary: 'My submitted versions (newest first) with receipts',
    tags,
    access: 'org',
    params: P.orgAssignment,
    handler: async ({ req, params }) => {
      const a = actor(req);
      const { assignment } = await requireAssignmentStudent(a, params.assignmentId);
      const sub = await Submission.findOne({ assignmentId: assignment._id, studentId: a.userId })
        .select({ _id: 1 })
        .lean<SubmissionDoc>();
      return sub ? loadVersions(sub._id) : [];
    },
  });

  return r;
}
