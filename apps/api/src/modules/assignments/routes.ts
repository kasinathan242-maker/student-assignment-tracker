import type { Request } from 'express';
import { Router } from 'express';
import { type z } from 'zod';
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  DEADLINE_FIELDS,
  LIMITS,
  MATERIAL_ASSIGNMENT_FIELDS,
  assignmentCrossFieldIssues,
  assignmentTransitionSchema,
  createAssignmentSchema,
  duplicateAssignmentSchema,
  listAssignmentsQuerySchema,
  nextAssignmentStatus,
  paginationQuerySchema,
  rubricMaxPoints,
  scheduleAssignmentSchema,
  updateAssignmentSchema,
  type AssignmentAction,
  type AssignmentChangeDTO,
  type AssignmentStatsDTO,
} from '@sat/shared';
import { withTransaction } from '../../db/connection';
import { errors } from '../../lib/errors';
import { paginate, searchRegex, skipFor, toSort } from '../../lib/pagination';
import { P, route } from '../../lib/route';
import { limits } from '../../middleware/rateLimit';
import {
  Assignment,
  AssignmentChange,
  FileObject,
  Grade,
  Rubric,
  Section,
  Submission,
  toId,
  type AssignmentChangeDoc,
  type AssignmentDoc,
  type FileObjectDoc,
  type Id,
  type RubricDoc,
} from '../../models';
import {
  actor,
  isOrgAdmin,
  loadAssignmentAccess,
  myCourseIds,
  requireAssignmentInstructor,
  requireAssignmentManager,
  requireCourseInstructor,
  type Actor,
} from '../../services/access';
import { audit } from '../../services/audit';
import { deleteStoredFile, singleUpload, storeUpload } from '../../services/files';
import { enqueue } from '../../services/outbox';
import { loadPeople, personRef } from '../common/serializers';
import { recipientIds, reloadAssignment, serializeAssignments, studentVisibleAssignments } from './service';

const tags = ['Assignments'];

const DATE_FIELDS = new Set(['availableFrom', 'dueAt', 'availableUntil']);

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    if ('toHexString' in value) return String(value);
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, normalize(v)]),
    );
  }
  return value ?? null;
}

/**
 * A rubric-graded assignment is scored as the sum of its criteria, so the rubric total must equal the
 * assignment's points: otherwise full marks are either impossible or rejected as exceeding the maximum.
 */
async function assertRubricMatchesPoints(
  a: Actor,
  rubricId: string | Id | null | undefined,
  maxPoints: number,
) {
  if (!rubricId) return;
  const rubric = await Rubric.findOne({ _id: rubricId, orgId: a.orgId })
    .select({ criteria: 1 })
    .lean<RubricDoc>();
  if (!rubric) return; // existence is checked by validateReferences
  const total = rubricMaxPoints(rubric.criteria);
  if (total !== maxPoints) {
    throw errors.validation(
      `The rubric is worth ${total} points but the assignment is worth ${maxPoints}. Make them equal.`,
      { maxPoints: [`Must equal the rubric total (${total})`] },
      'rubric_points_mismatch',
    );
  }
}

async function validateReferences(
  a: Actor,
  courseId: Id,
  input: { rubricId?: string | null; sectionIds?: string[] },
) {
  if (input.rubricId && !(await Rubric.exists({ _id: input.rubricId, orgId: a.orgId, status: 'active' }))) {
    throw errors.validation('That rubric is not available.', { rubricId: ['Unknown rubric'] });
  }
  if (input.sectionIds && input.sectionIds.length > 0) {
    const count = await Section.countDocuments({ _id: { $in: input.sectionIds }, courseId });
    if (count !== new Set(input.sectionIds).size)
      throw errors.validation('One or more sections do not belong to this course.', {
        sectionIds: ['Unknown section'],
      });
  }
}

async function serializeOne(
  req: Request,
  a: Actor,
  doc: AssignmentDoc,
  canManage: boolean,
  asStudent: boolean,
) {
  const [dto] = await serializeAssignments([doc], {
    viewerId: a.userId,
    asStudent,
    canManage,
    now: req.receivedAt,
  });
  return dto;
}

/** Applies a lifecycle transition with optimistic concurrency and records it in the change history. */
async function transition(
  req: Request,
  assignmentId: string,
  action: AssignmentAction,
  expectedRev: number,
  extra: Record<string, unknown> = {},
  note?: string,
) {
  const a = actor(req);
  const { assignment } = await requireAssignmentInstructor(a, assignmentId, { write: action !== 'archive' });
  if (assignment.rev !== expectedRev) throw errors.staleRevision();
  const next = nextAssignmentStatus(assignment.status, action, {
    wasEverPublished: assignment.publishedAt != null,
  });
  if (!next)
    throw errors.conflict(
      `You cannot ${action} an assignment that is ${assignment.status}.`,
      'invalid_transition',
    );
  const now = req.receivedAt;
  const set: Record<string, unknown> = { status: next, ...extra };
  if (action === 'publish') {
    if (assignment.dueAt.getTime() <= now.getTime()) {
      throw errors.validation(
        'The due date is in the past. Update it before publishing.',
        { dueAt: ['Must be in the future'] },
        'due_in_past',
      );
    }
    set.publishedAt = now;
    set.publishAt = null;
  }
  if (action === 'unschedule') set.publishAt = null;
  if (action === 'close') set.closedAt = now;
  if (action === 'reopen') set.closedAt = null;
  if (action === 'archive') set.archivedAt = now;
  if (action === 'restore') set.archivedAt = null;

  const updated = await withTransaction(async (session) => {
    const doc = await Assignment.findOneAndUpdate(
      { _id: assignment._id, rev: expectedRev },
      { $set: set, $inc: { rev: 1 } },
      { returnDocument: 'after', session },
    ).lean<AssignmentDoc>();
    if (!doc) throw errors.staleRevision();
    await AssignmentChange.create(
      [
        {
          orgId: assignment.orgId,
          assignmentId: assignment._id,
          actorId: a.userId,
          kind: 'status',
          changedFields: ['status'],
          before: { status: assignment.status },
          after: { status: next, ...(normalize(extra) as object) },
          material: false,
          note: note ?? null,
        },
      ],
      { session },
    );
    if (action === 'publish') {
      await enqueue(
        'assignment.published',
        { assignmentId: assignment._id.toString() },
        { session, dedupeKey: `assignment.published:${assignment._id.toString()}` },
      );
    }
    return doc;
  });
  await audit({
    req,
    action: `assignment.${action}`,
    targetType: 'assignment',
    targetId: assignment._id,
    metadata: { from: assignment.status, to: next, ...extra },
  });
  return serializeOne(req, a, updated, true, false);
}

export function assignmentRoutes(): Router {
  const r = Router();

  const listHandler = async (
    req: Request,
    query: z.output<typeof listAssignmentsQuerySchema>,
    courseId?: string,
  ) => {
    const a = actor(req);
    const [teaching, studying] = await Promise.all([myCourseIds(a, 'instructor'), myCourseIds(a, 'student')]);
    const filter: Record<string, unknown> = { orgId: toId(a.orgId) };
    const requested = courseId ?? query.courseId;
    let asStudent = false;
    let canManage = false;
    if (requested) {
      const cid = toId(requested);
      if (teaching.some((c) => c.equals(cid)) || isOrgAdmin(a)) canManage = true;
      else if (studying.some((c) => c.equals(cid))) asStudent = true;
      else throw errors.notFound('Course');
      filter.courseId = cid;
    } else if (teaching.length > 0 || isOrgAdmin(a)) {
      canManage = true;
      if (!isOrgAdmin(a)) filter.courseId = { $in: teaching };
    } else {
      asStudent = true;
      filter.courseId = { $in: studying };
    }

    if (asStudent) {
      filter.status = { $in: ['published', 'closed'] };
    } else if (query.status) {
      filter.status = query.status;
    } else if (!query.includeArchived) {
      filter.status = { $ne: 'archived' };
    }
    if (query.type) filter.type = query.type;
    const rx = searchRegex(query.q);
    if (rx) filter.title = rx;
    if (query.dueFrom || query.dueTo) {
      filter.dueAt = {
        ...(query.dueFrom ? { $gte: new Date(query.dueFrom) } : {}),
        ...(query.dueTo ? { $lte: new Date(query.dueTo) } : {}),
      };
    }

    if (!asStudent) {
      const [items, total] = await Promise.all([
        Assignment.find(filter)
          .sort(toSort(query.sort))
          .skip(skipFor(query.page, query.pageSize))
          .limit(query.pageSize)
          .lean<AssignmentDoc[]>(),
        Assignment.countDocuments(filter),
      ]);
      return paginate(
        await serializeAssignments(items, {
          viewerId: a.userId,
          asStudent: false,
          canManage,
          now: req.receivedAt,
        }),
        total,
        query.page,
        query.pageSize,
      );
    }

    // Students: section targeting and the derived-status bucket are evaluated per assignment.
    const { status: _status, orgId: _org, courseId: courseFilter, ...rest } = filter;
    let dtos = await studentVisibleAssignments(a, req.receivedAt, {
      ...rest,
      ...(courseFilter ? { courseId: courseFilter } : {}),
      ...(query.status && ['published', 'closed'].includes(query.status) ? { status: query.status } : {}),
    });
    if (query.sort !== 'dueAt') {
      const desc = query.sort.startsWith('-');
      const field = query.sort.replace('-', '') as 'dueAt' | 'title' | 'createdAt' | 'status';
      dtos = [...dtos].sort(
        (x, y) => (x[field] < y[field] ? -1 : x[field] > y[field] ? 1 : 0) * (desc ? -1 : 1),
      );
    }
    if (query.bucket) {
      const now = req.receivedAt.getTime();
      dtos = dtos.filter((d) => {
        const s = d.my?.displayStatus;
        const due = new Date(d.my?.effectiveDueAt ?? d.dueAt).getTime();
        switch (query.bucket) {
          case 'upcoming':
            return due >= now && (s === 'not_started' || s === 'draft' || s === 'withdrawn');
          case 'pending':
            return s === 'not_started' || s === 'draft' || s === 'withdrawn' || s === 'overdue';
          case 'submitted':
            return s === 'submitted' || s === 'late' || s === 'resubmitted';
          case 'overdue':
            return s === 'overdue' || s === 'missing';
          case 'graded':
            return s === 'graded';
          case 'returned':
            return s === 'returned';
          default:
            return true;
        }
      });
    }
    const start = skipFor(query.page, query.pageSize);
    return paginate(dtos.slice(start, start + query.pageSize), dtos.length, query.page, query.pageSize);
  };

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/assignments',
    summary: 'Assignments across my courses (students see only published work targeted at them)',
    tags,
    access: 'org',
    params: P.org,
    query: listAssignmentsQuerySchema,
    handler: ({ req, query }) => listHandler(req, query),
  });

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/courses/:courseId/assignments',
    summary: 'Assignments in a course',
    tags,
    access: 'org',
    params: P.orgCourse,
    query: listAssignmentsQuerySchema,
    handler: ({ req, params, query }) => listHandler(req, query, params.courseId),
  });

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/courses/:courseId/assignments',
    summary: 'Create an assignment (saved as draft)',
    tags,
    access: 'org',
    orgRoles: ['teacher', 'org_admin'],
    params: P.orgCourse,
    body: createAssignmentSchema,
    handler: async ({ req, params, body }) => {
      const a = actor(req);
      const { course } = await requireCourseInstructor(a, params.courseId, { write: true });
      await validateReferences(a, course._id, body);
      await assertRubricMatchesPoints(a, body.rubricId, body.maxPoints);
      const doc = await withTransaction(async (session) => {
        const [created] = await Assignment.create(
          [
            {
              ...body,
              orgId: a.orgId,
              courseId: course._id,
              createdBy: a.userId,
              availableFrom: body.availableFrom ? new Date(body.availableFrom) : null,
              dueAt: new Date(body.dueAt),
              availableUntil: body.availableUntil ? new Date(body.availableUntil) : null,
              status: 'draft',
            },
          ],
          { session },
        );
        if (!created) throw new Error('assignment creation failed');
        await AssignmentChange.create(
          [
            {
              orgId: a.orgId,
              assignmentId: created._id,
              actorId: a.userId,
              kind: 'created',
              changedFields: [],
              before: {},
              after: { title: body.title },
              material: false,
            },
          ],
          { session },
        );
        return created.toObject() as AssignmentDoc;
      });
      await audit({
        req,
        action: 'assignment.created',
        targetType: 'assignment',
        targetId: doc._id,
        metadata: { courseId: course._id, title: doc.title },
      });
      return serializeOne(req, a, doc, true, false);
    },
  });

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/assignments/:assignmentId',
    summary: 'Assignment details (with the student’s own status for students)',
    tags,
    access: 'org',
    params: P.orgAssignment,
    handler: async ({ req, params }) => {
      const a = actor(req);
      const access = await loadAssignmentAccess(a, params.assignmentId);
      return serializeOne(
        req,
        a,
        access.assignment,
        access.canManage,
        !access.canManage && access.isRecipient,
      );
    },
  });

  route(r, {
    method: 'patch',
    path: '/orgs/:orgId/assignments/:assignmentId',
    summary:
      'Edit an assignment (optimistic concurrency via expectedRev; material changes are recorded and announced)',
    tags,
    access: 'org',
    params: P.orgAssignment,
    body: updateAssignmentSchema,
    handler: async ({ req, params, body }) => {
      const a = actor(req);
      const { assignment, course } = await requireAssignmentInstructor(a, params.assignmentId, {
        write: true,
      });
      if (assignment.status === 'archived')
        throw errors.conflict('Restore this assignment before editing it.', 'archived');
      if (assignment.rev !== body.expectedRev) throw errors.staleRevision();
      const { expectedRev, changeNote, ...changes } = body;
      const set: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined) continue;
        set[key] =
          DATE_FIELDS.has(key) && value
            ? new Date(value as string)
            : key === 'rubricId' && value
              ? toId(value as string)
              : key === 'sectionIds'
                ? (value as string[]).map(toId)
                : value;
      }
      const merged = { ...assignment, ...set } as AssignmentDoc;
      const issues = assignmentCrossFieldIssues(merged);
      if (Object.keys(issues).length)
        throw errors.validation(
          'Some fields are invalid.',
          Object.fromEntries(Object.entries(issues).map(([k, v]) => [k, [v]])),
        );
      await validateReferences(a, course._id, {
        rubricId: changes.rubricId ?? null,
        sectionIds: changes.sectionIds,
      });
      if ('rubricId' in set || 'maxPoints' in set) {
        await assertRubricMatchesPoints(a, merged.rubricId, merged.maxPoints);
      }

      const changed = Object.keys(set).filter(
        (k) =>
          JSON.stringify(normalize(set[k])) !==
          JSON.stringify(normalize(assignment[k as keyof AssignmentDoc])),
      );
      if (changed.length === 0) return serializeOne(req, a, assignment, true, false);
      if (
        (changed.includes('maxPoints') || changed.includes('rubricId')) &&
        (await Grade.exists({ assignmentId: assignment._id }))
      ) {
        throw errors.conflict(
          'Points and rubric cannot change after grading has started.',
          'grading_started',
        );
      }
      const material = changed.filter((k) => (MATERIAL_ASSIGNMENT_FIELDS as readonly string[]).includes(k));
      const visible = assignment.status === 'published' || assignment.status === 'closed';
      const deadlineChanged = material.some((k) => (DEADLINE_FIELDS as readonly string[]).includes(k));
      const before = Object.fromEntries(
        changed.map((k) => [k, normalize(assignment[k as keyof AssignmentDoc])]),
      );
      const after = Object.fromEntries(changed.map((k) => [k, normalize(set[k])]));

      const updated = await withTransaction(async (session) => {
        const doc = await Assignment.findOneAndUpdate(
          { _id: assignment._id, rev: expectedRev },
          { $set: Object.fromEntries(changed.map((k) => [k, set[k]])), $inc: { rev: 1 } },
          { returnDocument: 'after', runValidators: true, session },
        ).lean<AssignmentDoc>();
        if (!doc) throw errors.staleRevision();
        const [change] = await AssignmentChange.create(
          [
            {
              orgId: assignment.orgId,
              assignmentId: assignment._id,
              actorId: a.userId,
              kind: 'updated',
              changedFields: changed,
              before,
              after,
              material: material.length > 0,
              note: changeNote ?? null,
            },
          ],
          { session },
        );
        if (visible && material.length > 0 && change) {
          await enqueue(
            'assignment.changed',
            {
              assignmentId: assignment._id.toString(),
              changeId: change._id.toString(),
              deadlineChanged,
              fields: material,
            },
            { session, dedupeKey: `assignment.changed:${change._id.toString()}` },
          );
        }
        return doc;
      });
      await audit({
        req,
        action: 'assignment.updated',
        targetType: 'assignment',
        targetId: assignment._id,
        metadata: { fields: changed, material },
      });
      return serializeOne(req, a, updated, true, false);
    },
  });

  const simple: [AssignmentAction, string][] = [
    ['publish', 'Publish now and notify students'],
    ['unschedule', 'Cancel scheduled publication (back to draft)'],
    ['close', 'Close submissions (students with approved extensions may still submit)'],
    ['reopen', 'Reopen a closed assignment'],
    ['archive', 'Archive (hidden from students; data retained)'],
    ['restore', 'Restore an archived assignment'],
  ];
  for (const [action, summary] of simple) {
    route(r, {
      method: 'post',
      path: `/orgs/:orgId/assignments/:assignmentId/${action}`,
      summary,
      tags,
      access: 'org',
      status: 200,
      params: P.orgAssignment,
      body: assignmentTransitionSchema,
      handler: ({ req, params, body }) =>
        transition(req, params.assignmentId, action, body.expectedRev, {}, body.note),
    });
  }

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/assignments/:assignmentId/schedule',
    summary: 'Schedule publication at a future time',
    tags,
    access: 'org',
    status: 200,
    params: P.orgAssignment,
    body: scheduleAssignmentSchema,
    handler: async ({ req, params, body }) => {
      const publishAt = new Date(body.publishAt);
      const { assignment } = await requireAssignmentInstructor(actor(req), params.assignmentId, {
        write: true,
      });
      if (publishAt.getTime() <= req.receivedAt.getTime())
        throw errors.validation('Choose a time in the future.', { publishAt: ['Must be in the future'] });
      if (publishAt.getTime() >= assignment.dueAt.getTime())
        throw errors.validation('Publication must be before the due date.', {
          publishAt: ['Must be before the due date'],
        });
      return transition(req, params.assignmentId, 'schedule', body.expectedRev, { publishAt });
    },
  });

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/assignments/:assignmentId/duplicate',
    summary: 'Duplicate as a new draft, optionally into another course you teach',
    tags,
    access: 'org',
    params: P.orgAssignment,
    body: duplicateAssignmentSchema,
    handler: async ({ req, params, body }) => {
      const a = actor(req);
      const { assignment } = await requireAssignmentManager(a, params.assignmentId);
      const target = await requireCourseInstructor(a, body.targetCourseId ?? assignment.courseId, {
        write: true,
      });
      const sameCourse = target.course._id.equals(assignment.courseId);
      const { _id, createdAt: _c, updatedAt: _u, ...rest } = assignment;
      const copy = await Assignment.create({
        ...rest,
        courseId: target.course._id,
        createdBy: a.userId,
        title: body.title ?? `${assignment.title} (copy)`.slice(0, LIMITS.assignmentTitle),
        status: 'draft',
        publishAt: null,
        publishedAt: null,
        closedAt: null,
        archivedAt: null,
        gradesReleasedAt: null,
        sectionIds: sameCourse ? assignment.sectionIds : [],
        rev: 0,
      });
      await AssignmentChange.create({
        orgId: a.orgId,
        assignmentId: copy._id,
        actorId: a.userId,
        kind: 'created',
        changedFields: [],
        before: {},
        after: { duplicatedFrom: _id.toString() },
        material: false,
      });
      await audit({
        req,
        action: 'assignment.duplicated',
        targetType: 'assignment',
        targetId: copy._id,
        metadata: { from: _id, targetCourseId: target.course._id },
      });
      return serializeOne(req, a, copy.toObject() as AssignmentDoc, true, false);
    },
  });

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/assignments/:assignmentId/changes',
    summary: 'Change history',
    tags,
    access: 'org',
    params: P.orgAssignment,
    query: paginationQuerySchema,
    handler: async ({ req, params, query }) => {
      const { assignment } = await requireAssignmentManager(actor(req), params.assignmentId);
      const filter = { assignmentId: assignment._id };
      const [rows, total] = await Promise.all([
        AssignmentChange.find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip(skipFor(query.page, query.pageSize))
          .limit(query.pageSize)
          .lean<AssignmentChangeDoc[]>(),
        AssignmentChange.countDocuments(filter),
      ]);
      const people = await loadPeople(rows.map((c) => c.actorId));
      const items: AssignmentChangeDTO[] = rows.map((c) => ({
        id: c._id.toString(),
        actor: personRef(people, c.actorId),
        kind: c.kind,
        changedFields: c.changedFields,
        before: c.before,
        after: c.after,
        note: c.note,
        createdAt: c.createdAt.toISOString(),
      }));
      return paginate(items, total, query.page, query.pageSize);
    },
  });

  route(r, {
    method: 'get',
    path: '/orgs/:orgId/assignments/:assignmentId/stats',
    summary: 'Submission and grading statistics',
    tags,
    access: 'org',
    params: P.orgAssignment,
    handler: async ({ req, params }): Promise<AssignmentStatsDTO> => {
      const { assignment } = await requireAssignmentManager(actor(req), params.assignmentId);
      return assignmentStats(assignment, req.receivedAt);
    },
  });

  /* ───────────── reference attachments ───────────── */

  route(r, {
    method: 'post',
    path: '/orgs/:orgId/assignments/:assignmentId/attachments',
    summary: 'Attach a reference file (max 50 MB)',
    tags,
    access: 'org',
    requestContentType: 'multipart/form-data',
    params: P.orgAssignment,
    middleware: [limits.upload(), singleUpload(50 * 1024 * 1024)],
    handler: async ({ req, params }) => {
      const a = actor(req);
      const { assignment } = await requireAssignmentInstructor(a, params.assignmentId, { write: true });
      if (assignment.attachmentIds.length >= LIMITS.assignmentAttachments)
        throw errors.conflict(`At most ${LIMITS.assignmentAttachments} attachments.`, 'too_many_files');
      const file = await storeUpload(req.file, {
        purpose: 'assignment_attachment',
        orgId: a.orgId,
        ownerId: a.userId,
        allowedExtensions: ALLOWED_UPLOAD_EXTENSIONS,
        maxBytes: 50 * 1024 * 1024,
        assignmentId: assignment._id,
        attachedTo: { type: 'assignment', id: assignment._id },
      });
      const updated = await Assignment.findOneAndUpdate(
        { _id: assignment._id, [`attachmentIds.${LIMITS.assignmentAttachments - 1}`]: { $exists: false } },
        { $push: { attachmentIds: file._id } },
        { returnDocument: 'after' },
      ).lean<AssignmentDoc>();
      if (!updated) {
        await deleteStoredFile(file);
        throw errors.conflict(`At most ${LIMITS.assignmentAttachments} attachments.`, 'too_many_files');
      }
      await FileObject.updateOne({ _id: file._id }, { $set: { status: 'attached' } });
      await audit({
        req,
        action: 'assignment.attachment_added',
        targetType: 'assignment',
        targetId: assignment._id,
        metadata: { fileId: file._id, name: file.originalName },
      });
      return serializeOne(req, a, updated, true, false);
    },
  });

  route(r, {
    method: 'delete',
    path: '/orgs/:orgId/assignments/:assignmentId/attachments/:id',
    summary: 'Remove a reference file',
    tags,
    access: 'org',
    status: 200,
    params: P.orgAssignmentId,
    handler: async ({ req, params }) => {
      const a = actor(req);
      const { assignment } = await requireAssignmentInstructor(a, params.assignmentId, { write: true });
      const fileId = toId(params.id);
      if (!assignment.attachmentIds.some((f) => f.equals(fileId))) throw errors.notFound('Attachment');
      const updated = await Assignment.findOneAndUpdate(
        { _id: assignment._id },
        { $pull: { attachmentIds: fileId } },
        { returnDocument: 'after' },
      ).lean<AssignmentDoc>();
      // Duplicated assignments share attachment objects; only delete when nothing references the file.
      if (!(await Assignment.exists({ attachmentIds: fileId }))) {
        const file = await FileObject.findById(fileId).lean<FileObjectDoc>();
        if (file) await deleteStoredFile(file);
      }
      await audit({
        req,
        action: 'assignment.attachment_removed',
        targetType: 'assignment',
        targetId: assignment._id,
        metadata: { fileId },
      });
      return serializeOne(req, a, updated ?? (await reloadAssignment(assignment._id)), true, false);
    },
  });

  return r;
}

/**
 * Metric definitions (docs/metrics.md):
 *  - targeted:      active student enrollments matching the assignment's sections.
 *  - submitted:     targeted students whose submission is submitted, graded or returned (withdrawn excluded).
 *  - late:          of those, current version submitted after the late threshold.
 *  - missing:       targeted students with no current submission once submissions are no longer accepted.
 *  - averagePercent: mean of published final scores as a percentage of max points.
 */
export async function assignmentStats(assignment: AssignmentDoc, now: Date): Promise<AssignmentStatsDTO> {
  const targetedIds = await recipientIds(assignment);
  const [subs, grades] = await Promise.all([
    Submission.aggregate<{ _id: { state: string; late: boolean }; n: number }>([
      { $match: { assignmentId: assignment._id, studentId: { $in: targetedIds } } },
      { $group: { _id: { state: '$state', late: '$isLate' }, n: { $sum: 1 } } },
    ]),
    Grade.aggregate<{
      draft: number;
      published: number;
      avg: number | null;
      buckets: { _id: number; n: number }[];
    }>([
      { $match: { assignmentId: assignment._id, studentId: { $in: targetedIds } } },
      {
        $facet: {
          draft: [{ $match: { draft: { $ne: null } } }, { $count: 'n' }],
          published: [{ $match: { published: { $ne: null } } }, { $count: 'n' }],
          avg: [
            { $match: { published: { $ne: null } } },
            {
              $group: {
                _id: null,
                v: {
                  $avg: {
                    $cond: [
                      { $gt: ['$published.maxPoints', 0] },
                      { $multiply: [{ $divide: ['$published.finalPoints', '$published.maxPoints'] }, 100] },
                      0,
                    ],
                  },
                },
              },
            },
          ],
          buckets: [
            { $match: { published: { $ne: null }, 'published.maxPoints': { $gt: 0 } } },
            {
              $project: {
                b: {
                  $min: [
                    9,
                    {
                      $floor: {
                        $divide: [
                          {
                            $multiply: [{ $divide: ['$published.finalPoints', '$published.maxPoints'] }, 100],
                          },
                          10,
                        ],
                      },
                    },
                  ],
                },
              },
            },
            { $group: { _id: '$b', n: { $sum: 1 } } },
          ],
        },
      },
      {
        $project: {
          draft: { $ifNull: [{ $arrayElemAt: ['$draft.n', 0] }, 0] },
          published: { $ifNull: [{ $arrayElemAt: ['$published.n', 0] }, 0] },
          avg: { $arrayElemAt: ['$avg.v', 0] },
          buckets: 1,
        },
      },
    ]),
  ]);
  const count = (pred: (s: { state: string; late: boolean }) => boolean) =>
    subs.filter((s) => pred(s._id)).reduce((t, s) => t + s.n, 0);
  const submitted = count((s) => ['submitted', 'graded', 'returned'].includes(s.state));
  const late = count((s) => ['submitted', 'graded', 'returned'].includes(s.state) && s.late);
  const returned = count((s) => s.state === 'returned');
  const notSubmitted = targetedIds.length - submitted;
  const accepting =
    assignment.status === 'published' &&
    (!assignment.availableUntil || assignment.availableUntil > now) &&
    (assignment.latePolicy.mode !== 'reject' ||
      assignment.dueAt.getTime() + assignment.gracePeriodMinutes * 60_000 > now.getTime());
  const g = grades[0];
  const distribution = Array.from({ length: 10 }, (_, i) => ({
    bucket: i === 9 ? '90–100%' : `${i * 10}–${i * 10 + 9}%`,
    count: g?.buckets.find((b) => b._id === i)?.n ?? 0,
  }));
  return {
    targeted: targetedIds.length,
    submitted,
    onTime: submitted - late,
    late,
    returned,
    gradedDraft: g?.draft ?? 0,
    gradedPublished: g?.published ?? 0,
    notSubmitted,
    missing: accepting ? 0 : notSubmitted,
    averagePercent: g?.avg != null ? Math.round(g.avg * 10) / 10 : null,
    distribution,
  };
}
