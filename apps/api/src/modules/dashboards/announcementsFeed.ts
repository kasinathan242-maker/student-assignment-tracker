import type { AnnouncementDTO } from '@sat/shared';
import {
  Announcement,
  AnnouncementReceipt,
  Course,
  type AnnouncementDoc,
  type AnnouncementReceiptDoc,
  type CourseDoc,
} from '../../models';
import type { Actor } from '../../services/access';
import { loadPeople, personRef } from '../common/serializers';
import { visibleFilter } from '../announcements/routes';

/** Latest announcements visible to the caller, for dashboards (read-only view, no management data). */
export async function serializeAnnouncementsForDashboard(
  a: Actor,
  now: Date,
  limit: number,
): Promise<AnnouncementDTO[]> {
  const rows = await Announcement.find(await visibleFilter(a, now))
    .sort({ publishedAt: -1, _id: -1 })
    .limit(limit)
    .lean<AnnouncementDoc[]>();
  const [people, courses, receipts] = await Promise.all([
    loadPeople(rows.map((x) => x.authorId)),
    Course.find({ _id: { $in: rows.map((x) => x.courseId).filter(Boolean) } })
      .select({ code: 1 })
      .lean<CourseDoc[]>(),
    AnnouncementReceipt.find({ announcementId: { $in: rows.map((x) => x._id) }, userId: a.userId }).lean<
      AnnouncementReceiptDoc[]
    >(),
  ]);
  const code = new Map(courses.map((c) => [c._id.toString(), c.code]));
  const receipt = new Map(receipts.map((x) => [x.announcementId.toString(), x]));
  return rows.map((x) => ({
    id: x._id.toString(),
    orgId: x.orgId.toString(),
    courseId: x.courseId?.toString() ?? null,
    courseCode: x.courseId ? (code.get(x.courseId.toString()) ?? null) : null,
    title: x.title,
    body: x.body,
    audience: x.audience,
    status: x.status,
    publishAt: x.publishAt?.toISOString() ?? null,
    publishedAt: x.publishedAt?.toISOString() ?? null,
    expiresAt: x.expiresAt?.toISOString() ?? null,
    requireAck: x.requireAck,
    sendEmail: x.sendEmail,
    author: personRef(people, x.authorId),
    readAt: receipt.get(x._id.toString())?.readAt?.toISOString() ?? null,
    acknowledgedAt: receipt.get(x._id.toString())?.acknowledgedAt?.toISOString() ?? null,
    canManage: false,
    rev: x.rev,
    createdAt: x.createdAt.toISOString(),
    updatedAt: x.updatedAt.toISOString(),
    stats: null,
  }));
}
