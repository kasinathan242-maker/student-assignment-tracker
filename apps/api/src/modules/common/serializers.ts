import type { FileDTO, PersonRef } from '@sat/shared';
import { FileObject, User, type FileObjectDoc, type Id } from '../../models';

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export function serializeFile(
  file: Pick<FileObjectDoc, '_id' | 'originalName' | 'size' | 'mimeType' | 'scanStatus' | 'createdAt'>,
): FileDTO {
  return {
    id: file._id.toString(),
    name: file.originalName,
    size: file.size,
    mimeType: file.mimeType,
    scanStatus: file.scanStatus,
    createdAt: file.createdAt.toISOString(),
    downloadPath: `/api/v1/files/${file._id.toString()}/download`,
  };
}

export async function loadFiles(ids: Id[]): Promise<Map<string, FileDTO>> {
  if (ids.length === 0) return new Map();
  const files = await FileObject.find({ _id: { $in: ids }, status: { $ne: 'deleted' } }).lean<
    FileObjectDoc[]
  >();
  return new Map(files.map((f) => [f._id.toString(), serializeFile(f)]));
}

/** Batch-loads display names (single query; avoids N+1 lookups in list serializers). */
export async function loadPeople(
  ids: (Id | null | undefined)[],
): Promise<Map<string, PersonRef & { email: string }>> {
  const unique = [...new Set(ids.filter((i): i is Id => i != null).map((i) => i.toString()))];
  if (unique.length === 0) return new Map();
  const users = await User.find({ _id: { $in: unique } })
    .select({ name: 1, email: 1 })
    .lean<{ _id: Id; name: string; email: string }[]>();
  return new Map(
    users.map((u) => [u._id.toString(), { id: u._id.toString(), name: u.name, email: u.email }]),
  );
}

export function personRef(
  map: Map<string, PersonRef & { email: string }>,
  id: Id | null | undefined,
): PersonRef | null {
  if (!id) return null;
  const p = map.get(id.toString());
  return p ? { id: p.id, name: p.name } : null;
}
