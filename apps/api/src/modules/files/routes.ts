import { Router } from 'express';
import { z } from 'zod';
import { errors } from '../../lib/errors';
import { requireAuth } from '../../lib/request';
import { P, route } from '../../lib/route';
import {
  Assignment,
  FileObject,
  Membership,
  Organization,
  Submission,
  type AssignmentDoc,
  type FileObjectDoc,
  type MembershipDoc,
  type OrganizationDoc,
  type SubmissionDoc,
} from '../../models';
import { loadAssignmentAccess, requireAssignmentInstructor, type Actor } from '../../services/access';
import { audit } from '../../services/audit';
import { streamFile } from '../../services/files';

/**
 * Authenticated download proxy. Storage objects are private; every download re-checks authorization
 * against the file's owning context:
 *  - assignment attachments: anyone who can view an assignment that references the file;
 *  - submission files: the submitting student, or an instructor of the course;
 *  - org administrators only via the audited break-glass path (reason required).
 * Unknown or unauthorized files return 404.
 */
export function fileRoutes(): Router {
  const r = Router();

  route(r, {
    method: 'get',
    path: '/files/:id/download',
    summary: 'Download a file you are authorized to access (always served as an attachment)',
    tags: ['Files'],
    access: 'user',
    params: P.id,
    query: z.object({ reason: z.string().trim().max(1000).optional() }),
    responseContentType: 'application/octet-stream',
    handler: async ({ req, res, params, query }) => {
      const auth = requireAuth(req);
      const file = await FileObject.findOne({
        _id: params.id,
        status: { $ne: 'deleted' },
      }).lean<FileObjectDoc>();
      if (!file || !file.orgId || file.purpose === 'avatar') throw errors.notFound('File');
      const [membership, org] = await Promise.all([
        Membership.findOne({
          orgId: file.orgId,
          userId: auth.userId,
          status: 'active',
        }).lean<MembershipDoc>(),
        Organization.findById(file.orgId).lean<OrganizationDoc>(),
      ]);
      if (!membership || !org || org.status !== 'active') throw errors.notFound('File');
      const a: Actor = { userId: auth.userId, orgId: file.orgId.toString(), orgRole: membership.role };

      let allowed = false;
      let auditAction: string | null = null;
      if (file.purpose === 'assignment_attachment') {
        const assignments = await Assignment.find({ orgId: file.orgId, attachmentIds: file._id })
          .select({ _id: 1 })
          .limit(20)
          .lean<AssignmentDoc[]>();
        for (const asg of assignments) {
          try {
            await loadAssignmentAccess(a, asg._id.toString());
            allowed = true;
            break;
          } catch {
            /* try the next referencing assignment */
          }
        }
      } else if (file.purpose === 'submission') {
        if (file.ownerId.toString() === auth.userId) {
          allowed = true;
        } else if (file.assignmentId) {
          // Only files that were actually submitted are visible to staff (never a student's unsent uploads).
          const submitted =
            file.status === 'attached' &&
            (await Submission.exists({
              assignmentId: file.assignmentId,
              studentId: file.ownerId,
              state: { $ne: 'draft' },
            }));
          if (submitted) {
            try {
              await requireAssignmentInstructor(a, file.assignmentId.toString());
              allowed = true;
              auditAction = 'file.downloaded';
            } catch {
              if (membership.role === 'org_admin' && query.reason) {
                allowed = true;
                auditAction = 'admin.file_accessed';
              }
            }
          }
        }
      }
      if (!allowed) throw errors.notFound('File');
      if (auditAction) {
        const sub = file.assignmentId
          ? await Submission.findOne({ assignmentId: file.assignmentId, studentId: file.ownerId })
              .select({ _id: 1 })
              .lean<SubmissionDoc>()
          : null;
        await audit({
          req,
          orgId: file.orgId,
          action: auditAction,
          targetType: 'file',
          targetId: file._id,
          metadata: { submissionId: sub?._id, reason: query.reason },
        });
      }
      await streamFile(req, res, file);
    },
  });

  return r;
}
