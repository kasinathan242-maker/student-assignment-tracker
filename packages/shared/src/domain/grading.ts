import { latePenaltyPoints, type LatePolicy } from './deadline';

export interface RubricLevel {
  title: string;
  points: number;
  description?: string;
}

export interface RubricCriterion {
  id: string;
  title: string;
  description?: string;
  maxPoints: number;
  levels: RubricLevel[];
}

export interface RubricScore {
  criterionId: string;
  points: number;
  comment?: string;
}

export interface GradeInput {
  maxPoints: number;
  /** Direct points entry. Ignored when a rubric is used. */
  points?: number | null;
  rubric?: RubricCriterion[] | null;
  rubricScores?: RubricScore[];
}

export type GradeValidation =
  { ok: true; rawPoints: number } | { ok: false; errors: Record<string, string[]> };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Validates a grade against assignment max points and (optionally) a rubric snapshot, returning the raw
 * point total. Every rubric criterion must be scored, and no score may exceed its criterion maximum.
 */
export function validateGrade(input: GradeInput): GradeValidation {
  const errors: Record<string, string[]> = {};
  const add = (key: string, msg: string) => (errors[key] ??= []).push(msg);

  let raw: number;
  if (input.rubric && input.rubric.length > 0) {
    const scores = new Map<string, RubricScore>();
    for (const score of input.rubricScores ?? []) {
      if (scores.has(score.criterionId)) add(`rubricScores.${score.criterionId}`, 'Criterion scored twice.');
      scores.set(score.criterionId, score);
    }
    const known = new Set(input.rubric.map((c) => c.id));
    for (const id of scores.keys()) {
      if (!known.has(id)) add(`rubricScores.${id}`, 'Unknown rubric criterion.');
    }
    raw = 0;
    for (const criterion of input.rubric) {
      const score = scores.get(criterion.id);
      if (!score) {
        add(`rubricScores.${criterion.id}`, `Score "${criterion.title}".`);
        continue;
      }
      if (!Number.isFinite(score.points) || score.points < 0 || score.points > criterion.maxPoints) {
        add(`rubricScores.${criterion.id}`, `Must be between 0 and ${criterion.maxPoints}.`);
        continue;
      }
      raw += score.points;
    }
  } else {
    if (input.points == null) {
      add('points', 'Enter a score.');
      raw = 0;
    } else {
      raw = input.points;
    }
  }

  if (!Number.isFinite(raw) || raw < 0) add('points', 'Score cannot be negative.');
  else if (raw > input.maxPoints) add('points', `Score cannot exceed ${input.maxPoints}.`);

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, rawPoints: round2(raw) };
}

export function rubricMaxPoints(rubric: Pick<RubricCriterion, 'maxPoints'>[]): number {
  return round2(rubric.reduce((sum, c) => sum + c.maxPoints, 0));
}

export interface FinalScore {
  rawPoints: number;
  latePenaltyPoints: number;
  finalPoints: number;
  percentage: number;
}

export function computeFinalScore(
  rawPoints: number,
  maxPoints: number,
  lateByMinutes: number,
  latePolicy: LatePolicy,
): FinalScore {
  const penalty = latePenaltyPoints(rawPoints, lateByMinutes, latePolicy);
  const finalPoints = round2(Math.max(0, rawPoints - penalty));
  return {
    rawPoints,
    latePenaltyPoints: penalty,
    finalPoints,
    percentage: maxPoints > 0 ? round2((finalPoints / maxPoints) * 100) : 0,
  };
}
