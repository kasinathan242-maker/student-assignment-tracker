import { Router } from 'express';
import {
  decideExtensionSchema,
  grantExtensionSchema,
  listExtensionsQuerySchema,
  requestExtensionSchema,
  type ExtensionRequestDTO,
} from '@sat/shared';
import { isDuplicateKeyError, withTransaction } from '../../db/connection';
import { errors } from '../../lib/errors';
import { paginate, skipFor } from '../../lib/pagination';
import { P, route } from '../../lib/route';
import {
  Assignment,
  Course,
  Enrollment,
  ExtensionRequest,
  Submission,
  isValidId,
  toId,
  type AssignmentDoc,
  type CourseDoc,
  type ExtensionRequestDoc,
  type SubmissionDoc,
} from '../../models';
import {
  actor,
  isTargeted,
  myCourseIds,
  requireAssignmentInstructor,
  requireAssignmentStudent,
  type Actor,
} from '../../services/access';
import { audit } from '../../services/audit';
import { enqueue } from '../../services/outbox';
import { loadPeople, personRef } from '../common/serializers';
import { extensionDueAt } from '../assignments/service';

const tags = ['Extensions'];

async function serialize(rows: ExtensionRequestDoc[]): Promise<ExtensionRequestDTO[]> {
  const [assignments, courses, people] = await Promise.all([
    Assignment.find({ _id: { $in: rows.map((r) => r.assignmentId) } })
      .select({ title: 1 })
      .lean<AssignmentDoc[]>(),
    Course.find({ _id: { $in: rows.map((r) => r.courseId) } })
      .select({ code: 1 })
      .lean<CourseDoc[]>(),
    loadPeople(rows.flatMap((r) => [r.studentId, r.decidedBy])),
  ]);
  const title = new Map(assignments.map((x) => [x._id.toString(), x.title]));
  const code = new Map(courses.map((x) => [x._id.toString(), x.code]));
  return rows.map((r) => {
    const student = people.get(r.studentId.toString());
    return {
      id: r._id.toString(),
      assignmentId: r.assignmentId.toString(),
      assignmentTitle: title.get(r.assignmentId.toString()) ?? '',
      courseId: r.courseId.toString(),
      courseCode: code.get(r.courseId.toString()) ?? '',
      student: { id: r.studentId.toString(), name: student?.name ?? 'Unknown', email: student?.email ?? '' },
      reason: r.reason,
      requestedDueAt: r.requestedDueAt.toISOString(),
      originalDueAt: r.originalDueAt.toISOString(),
      status: r.status,
      approvedDueAt: r.approvedDueAt?.toISOString() ?? null,
      decisionNote: r.decisionNote,
      decidedBy: personRef(people, r.decidedBy),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

async function loadRequestForInstructor(a: Actor, id: string) {
  if (!isValidId(id)) throw errors.notFound('Extension request');
  const request = await ExtensionRequest.findOne({ _id: id, orgId: a.orgId }).lean<ExtensionRequestDoc>();
  if (!request) throw errors.notFound('Extension request');
  const access = await requireAssignmentInstructor(a, request.assignmentId.toString(), { write: true }).catch(
    () => {
      throw errors.notFound('Extension request');
    },
  );
  return { request, ...access };
}

export function extensionRoutes(): Router {
  const r = Router();

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/assignments/:assignmentId/extension-requests',
    summary: 'Request a deadline extension (when the instructor allows requests)',
    tags,
    access: 'org',
    params: P.orgAssignment,
    body: requestExtensionSchema,
    handler: async ({ req, params, body }) => {
      const a = actor(req);
      const { assignment } = await requireAssignmentStudent(a, params.assignmentId);
      if (!assignment.extensionsAllowed)
        throw errors.forbidden('This assignment does not accept extension requests.', 'extensions_disabled');
      const sub = await Submission.findOne({ assignmentId: assignment._id, studentId: a.userId })
        .select({ state: 1 })
        .lean<SubmissionDoc>();
      if (sub?.state === 'graded')
        throw errors.conflict('This work has already been graded.', 'already_graded');
      const currentDue = (await extensionDueAt(assignment._id, a.userId)) ?? assignment.dueAt;
      const requested = new Date(body.requestedDueAt);
      if (requested.getTime() <= currentDue.getTime()) {
        throw errors.validation('Request a date after your current due date.', {
          requestedDueAt: ['Must be after the current due date'],
        });
      }
      if (requested.getTime() - assignment.dueAt.getTime() > 180 * 86_400_000) {
        throw errors.validation('Extensions are limited to 180 days.', {
          requestedDueAt: ['Too far in the future'],
        });
      }
      try {
        const doc = await withTransaction(async (session) => {
          const [created] = await ExtensionRequest.create(
            [
              {
                orgId: a.orgId,
                courseId: assignment.courseId,
                assignmentId: assignment._id,
                studentId: a.userId,
                reason: body.reason,
                requestedDueAt: requested,
                originalDueAt: currentDue,
              },
            ],
            { session },
          );
          if (!created) throw new Error('extension creation failed');
          await enqueue(
            'extension.requested',
            { requestId: created._id.toString() },
            { session, dedupeKey: `extension.requested:${created._id.toString()}` },
          );
          return created.toObject() as ExtensionRequestDoc;
        });
        await audit({
          req,
          action: 'extension.requested',
          targetType: 'extension',
          targetId: doc._id,
          metadata: { assignmentId: assignment._id, requestedDueAt: requested },
        });
        return (await serialize([doc]))[0];
      } catch (err) {
        if (isDuplicateKeyError(err))
          throw errors.conflict('You already have a pending request for this assignment.', 'request_pending');
        throw err;
      }
    },
  });

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/extension-requests',
    summary: 'Extension requests: my own (students) or for courses I teach (instructors)',
    tags,
    access: 'org',
    params: P.org,
    query: listExtensionsQuerySchema,
    handler: async ({ req, query }) => {
      const a = actor(req);
      const taught = await myCourseIds(a, 'instructor');
      const filter: Record<string, unknown> = { orgId: a.orgId };
      if (taught.length > 0) filter.courseId = { $in: taught };
      else filter.studentId = toId(a.userId);
      if (query.courseId) {
        if (taught.length > 0 && !taught.some((c) => c.toString() === query.courseId))
          throw errors.notFound('Course');
        filter.courseId = toId(query.courseId);
      }
      if (query.status) filter.status = query.status;
      if (query.assignmentId) filter.assignmentId = toId(query.assignmentId);
      const [rows, total] = await Promise.all([
        ExtensionRequest.find(filter)
          .sort({ status: 1, createdAt: -1, _id: -1 })
          .skip(skipFor(query.page, query.pageSize))
          .limit(query.pageSize)
          .lean<ExtensionRequestDoc[]>(),
        ExtensionRequest.countDocuments(filter),
      ]);
      return paginate(await serialize(rows), total, query.page, query.pageSize);
    },
  });

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/extension-requests/:id/decide',
    summary: 'Approve (optionally with a different date) or deny a pending request',
    tags,
    access: 'org',
    status: 200,
    params: P.orgId,
    body: decideExtensionSchema,
    handler: async ({ req, params, body }) => {
      const a = actor(req);
      const { request, assignment } = await loadRequestForInstructor(a, params.id);
      if (request.status !== 'pending')
        throw errors.conflict('This request has already been decided.', 'already_decided');
      const approvedDueAt =
        body.decision === 'approve' ? new Date(body.approvedDueAt ?? request.requestedDueAt) : null;
      if (approvedDueAt && approvedDueAt.getTime() <= assignment.dueAt.getTime()) {
        throw errors.validation('An extension must end after the original due date.', {
          approvedDueAt: ['Must be after the due date'],
        });
      }
      const doc = await withTransaction(async (session) => {
        const updated = await ExtensionRequest.findOneAndUpdate(
          { _id: request._id, status: 'pending' },
          {
            $set: {
              status: body.decision === 'approve' ? 'approved' : 'denied',
              approvedDueAt,
              decisionNote: body.note || null,
              decidedBy: a.userId,
              decidedAt: req.receivedAt,
            },
          },
          { returnDocument: 'after', session },
        ).lean<ExtensionRequestDoc>();
        if (!updated) throw errors.conflict('This request has already been decided.', 'already_decided');
        await enqueue(
          'extension.decided',
          { requestId: updated._id.toString() },
          { session, dedupeKey: `extension.decided:${updated._id.toString()}` },
        );
        return updated;
      });
      await audit({
        req,
        action: `extension.${doc.status}`,
        targetType: 'extension',
        targetId: doc._id,
        metadata: { studentId: doc.studentId, approvedDueAt },
      });
      return (await serialize([doc]))[0];
    },
  });

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/extension-requests/:id/cancel',
    summary: 'Cancel my pending request',
    tags,
    access: 'org',
    status: 200,
    params: P.orgId,
    handler: async ({ req, params }) => {
      const a = actor(req);
      const doc = await ExtensionRequest.findOneAndUpdate(
        { _id: params.id, orgId: a.orgId, studentId: a.userId, status: 'pending' },
        { $set: { status: 'cancelled' } },
        { returnDocument: 'after' },
      ).lean<ExtensionRequestDoc>();
      if (!doc) throw errors.notFound('Pending request');
      await audit({ req, action: 'extension.cancelled', targetType: 'extension', targetId: doc._id });
      return (await serialize([doc]))[0];
    },
  });

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/assignments/:assignmentId/extensions',
    summary: 'Grant an extension directly to a student',
    tags,
    access: 'org',
    params: P.orgAssignment,
    body: grantExtensionSchema,
    handler: async ({ req, params, body }) => {
      const a = actor(req);
      const { assignment } = await requireAssignmentInstructor(a, params.assignmentId, { write: true });
      const enrollment = await Enrollment.findOne({
        courseId: assignment.courseId,
        userId: body.studentId,
        role: 'student',
        status: 'active',
      }).lean();
      if (!enrollment || !isTargeted(assignment, enrollment))
        throw errors.validation('This student is not assigned this work.', {
          studentId: ['Not a recipient'],
        });
      const dueAt = new Date(body.dueAt);
      if (dueAt.getTime() <= assignment.dueAt.getTime())
        throw errors.validation('An extension must end after the original due date.', {
          dueAt: ['Must be after the due date'],
        });
      const doc = await withTransaction(async (session) => {
        const pending = await ExtensionRequest.findOneAndUpdate(
          { assignmentId: assignment._id, studentId: body.studentId, status: 'pending' },
          {
            $set: {
              status: 'approved',
              approvedDueAt: dueAt,
              decisionNote: body.note || null,
              decidedBy: a.userId,
              decidedAt: req.receivedAt,
            },
          },
          { returnDocument: 'after', session },
        ).lean<ExtensionRequestDoc>();
        const result =
          pending ??
          ((
            await ExtensionRequest.create(
              [
                {
                  orgId: a.orgId,
                  courseId: assignment.courseId,
                  assignmentId: assignment._id,
                  studentId: body.studentId,
                  reason: 'Granted by instructor',
                  requestedDueAt: dueAt,
                  originalDueAt: (await extensionDueAt(assignment._id, body.studentId)) ?? assignment.dueAt,
                  status: 'approved',
                  approvedDueAt: dueAt,
                  decisionNote: body.note || null,
                  decidedBy: a.userId,
                  decidedAt: req.receivedAt,
                  granted: true,
                },
              ],
              { session },
            )
          )[0]?.toObject() as ExtensionRequestDoc);
        await enqueue(
          'extension.decided',
          { requestId: result._id.toString() },
          { session, dedupeKey: `extension.decided:${result._id.toString()}` },
        );
        return result;
      });
      await audit({
        req,
        action: 'extension.granted',
        targetType: 'extension',
        targetId: doc._id,
        metadata: { studentId: body.studentId, dueAt },
      });
      return (await serialize([doc]))[0];
    },
  });

  return r;
}
