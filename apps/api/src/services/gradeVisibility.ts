import { Assignment, type AssignmentDoc, type GradeDoc, type Id } from '../models';

/**
 * A grade is visible to the student only when it has been published AND the assignment's release policy
 * allows it: "immediate" assignments show published grades at once; "hold" assignments show nothing until
 * the instructor releases grades for the whole assignment.
 */
export function isGradeVisible(
  grade: Pick<GradeDoc, 'published'> | null | undefined,
  assignment: Pick<AssignmentDoc, 'gradeRelease' | 'gradesReleasedAt'>,
): boolean {
  if (!grade?.published) return false;
  return assignment.gradeRelease === 'immediate' || assignment.gradesReleasedAt != null;
}

export async function filterVisibleGrades<T extends Pick<GradeDoc, 'published' | 'assignmentId'>>(
  grades: T[],
): Promise<T[]> {
  const ids = [...new Set(grades.map((g) => g.assignmentId.toString()))];
  const assignments = await Assignment.find({ _id: { $in: ids } })
    .select({ gradeRelease: 1, gradesReleasedAt: 1 })
    .lean<Pick<AssignmentDoc, '_id' | 'gradeRelease' | 'gradesReleasedAt'>[]>();
  const byId = new Map<string, (typeof assignments)[number]>(assignments.map((a) => [a._id.toString(), a]));
  return grades.filter((g) => {
    const a = byId.get((g.assignmentId as Id).toString());
    return a ? isGradeVisible(g, a) : false;
  });
}
