import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Plus, Trash2 } from '../../components/ui/icons';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { LIMITS, rubricSchema, type CourseDTO, type Paginated, type RubricDTO } from '@sat/shared';
import { useOrg } from '../../app/org';
import { Button, ButtonLink } from '../../components/ui/button';
import { Alert, Badge, EmptyState, ErrorState, SkeletonRows } from '../../components/ui/feedback';
import { Field, FormError, Input, Select, Textarea } from '../../components/ui/form';
import { Card, CardBody, PageHeader } from '../../components/ui/layout';
import { ApiError, get, patch, post } from '../../lib/api';
import { formatDate } from '../../lib/format';

const RUBRIC_FIELD_LABEL: Record<string, string> = {
  title: 'name',
  maxPoints: 'max points',
  points: 'points',
  description: 'description',
};

/** "criteria.0.levels.1.points: Too big" becomes "Criterion 1, level 2: points: Too big". */
export function rubricIssueMessage(issue: { path: PropertyKey[]; message: string }): string {
  const [first, index, second, levelIndex, field] = issue.path;
  if (first !== 'criteria' || typeof index !== 'number') {
    return first === 'title' ? `Rubric name: ${issue.message}` : issue.message;
  }
  const where = [`Criterion ${index + 1}`];
  let leaf = second;
  if (second === 'levels' && typeof levelIndex === 'number') {
    where.push(`level ${levelIndex + 1}`);
    leaf = field;
  }
  const label = typeof leaf === 'string' ? RUBRIC_FIELD_LABEL[leaf] : undefined;
  const message =
    issue.message === 'Required' && label
      ? `${label} is required`
      : label
        ? `${label}: ${issue.message}`
        : issue.message;
  return `${where.join(', ')}: ${message}`;
}

export function RubricListPage() {
  const { api, path } = useOrg();
  const q = useQuery({
    queryKey: ['org', api, 'rubrics', 'list'],
    queryFn: () => get<Paginated<RubricDTO>>(`${api}/rubrics`, { pageSize: 100, includeArchived: 'true' }),
  });
  return (
    <div>
      <PageHeader
        title="Rubrics"
        description="Reusable grading criteria. Grades keep a snapshot of the rubric used, so later edits never change past results."
        actions={
          <ButtonLink to={path('/rubrics/new')} variant="primary">
            <Plus className="h-4 w-4" aria-hidden /> New rubric
          </ButtonLink>
        }
      />
      {q.isPending && <SkeletonRows />}
      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data?.items.length === 0 && (
        <EmptyState
          icon={ListChecks}
          title="No rubrics yet"
          description="Create a rubric and attach it to assignments for consistent, criterion-level grading."
        />
      )}
      <ul className="grid gap-3 md:grid-cols-2">
        {q.data?.items.map((r) => (
          <li key={r.id}>
            <Link
              to={path(`/rubrics/${r.id}`)}
              className="block rounded-[var(--radius-card)] border border-border bg-surface p-4 hover:border-border-strong hover:bg-surface-2"
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold">{r.title}</h2>
                {r.status === 'archived' && <Badge>Archived</Badge>}
              </div>
              <p className="mt-1 text-sm text-fg-muted">
                {r.criteria.length} criteria · {r.totalPoints} points · updated {formatDate(r.updatedAt)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface CriterionDraft {
  key: string;
  id?: string;
  title: string;
  description: string;
  maxPoints: string;
  levels: { title: string; points: string }[];
}

let keySeq = 0;
const newKey = () => `c${(keySeq += 1)}`;

export function RubricEditorPage() {
  const { rubricId } = useParams();
  const { api } = useOrg();
  const q = useQuery({
    queryKey: ['org', api, 'rubrics', rubricId],
    queryFn: () => get<RubricDTO>(`${api}/rubrics/${rubricId}`),
    enabled: Boolean(rubricId),
    refetchOnWindowFocus: false,
  });
  if (rubricId && q.isPending) return <SkeletonRows rows={6} />;
  if (rubricId && q.error) return <ErrorState error={q.error} />;
  return <RubricEditor key={q.data?.rev ?? 'new'} rubric={q.data} />;
}

function RubricEditor({ rubric }: { rubric?: RubricDTO }) {
  const { api, path } = useOrg();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const courses = useQuery({
    queryKey: ['org', api, 'courses', { teaching: true }],
    queryFn: () => get<Paginated<CourseDTO>>(`${api}/courses`, { pageSize: 100 }),
  });
  const [title, setTitle] = useState(rubric?.title ?? '');
  const [description, setDescription] = useState(rubric?.description ?? '');
  const [courseId, setCourseId] = useState(rubric?.courseId ?? '');
  const [criteria, setCriteria] = useState<CriterionDraft[]>(
    rubric?.criteria.map((c) => ({
      key: newKey(),
      id: c.id,
      title: c.title,
      description: c.description ?? '',
      maxPoints: String(c.maxPoints),
      levels: c.levels.map((l) => ({ title: l.title, points: String(l.points) })),
    })) ?? [{ key: newKey(), title: '', description: '', maxPoints: '10', levels: [] }],
  );
  const [error, setError] = useState<string | null>(null);
  const total = criteria.reduce((t, c) => t + (Number(c.maxPoints) || 0), 0);
  const update = (key: string, patchValue: Partial<CriterionDraft>) =>
    setCriteria((cs) => cs.map((c) => (c.key === key ? { ...c, ...patchValue } : c)));

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        title,
        description,
        courseId: courseId || null,
        criteria: criteria.map((c) => ({
          ...(c.id ? { id: c.id } : {}),
          title: c.title,
          description: c.description || undefined,
          maxPoints: Number(c.maxPoints),
          levels: c.levels
            .filter((l) => l.title.trim())
            .map((l) => ({ title: l.title, points: Number(l.points) })),
        })),
      };
      const parsed = rubricSchema.safeParse(body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new ApiError(400, 'validation', issue ? rubricIssueMessage(issue) : 'Check the rubric.');
      }
      if (rubric) {
        const { courseId: _c, ...rest } = body;
        return patch<RubricDTO>(`${api}/rubrics/${rubric.id}`, { ...rest, expectedRev: rubric.rev });
      }
      return post<RubricDTO>(`${api}/rubrics`, body);
    },
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['org', api, 'rubrics'] });
      toast.success('Rubric saved.');
      navigate(path(`/rubrics/${r.id}`), { replace: true });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save the rubric.'),
  });
  const archive = useMutation({
    mutationFn: () =>
      patch<RubricDTO>(`${api}/rubrics/${rubric?.id}`, {
        status: rubric?.status === 'active' ? 'archived' : 'active',
        expectedRev: rubric?.rev,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['org', api, 'rubrics'] });
      toast.success('Rubric updated.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Action failed.'),
  });

  return (
    <div className="max-w-3xl">
      <PageHeader
        breadcrumbs={[{ label: 'Rubrics', to: path('/rubrics') }, { label: rubric?.title ?? 'New rubric' }]}
        title={rubric ? 'Edit rubric' : 'New rubric'}
        description={`Total: ${total} points`}
      />
      <FormError message={error} />
      {rubric && (
        <Alert tone="info" className="my-4">
          Once this rubric has been used for grading, its criteria are locked: you can still rename or archive
          it, or create a new rubric to change criteria.
        </Alert>
      )}
      <div className="space-y-4">
        <Card>
          <CardBody className="space-y-4">
            <Field label="Title" required>
              {({ id }) => (
                <Input
                  id={id}
                  value={title}
                  maxLength={LIMITS.rubricTitle}
                  onChange={(e) => setTitle(e.target.value)}
                />
              )}
            </Field>
            <Field label="Description">
              {({ id }) => (
                <Textarea
                  id={id}
                  className="min-h-16"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              )}
            </Field>
            {!rubric && (
              <Field
                label="Share with a course"
                hint="Course instructors can use it. Leave blank to keep it personal."
              >
                {({ id, describedBy }) => (
                  <Select
                    id={id}
                    aria-describedby={describedBy}
                    value={courseId}
                    onChange={(e) => setCourseId(e.target.value)}
                  >
                    <option value="">Only me</option>
                    {courses.data?.items
                      .filter((c) => c.myRole === 'instructor')
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} · {c.title}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
            )}
          </CardBody>
        </Card>
        {criteria.map((c, i) => (
          <Card key={c.key}>
            <CardBody className="space-y-3">
              <div className="flex items-start gap-3">
                <Field label={`Criterion ${i + 1}`} className="flex-1" required>
                  {({ id }) => (
                    <Input
                      id={id}
                      value={c.title}
                      onChange={(e) => update(c.key, { title: e.target.value })}
                    />
                  )}
                </Field>
                <Field label="Max points" className="w-28" required>
                  {({ id }) => (
                    <Input
                      id={id}
                      type="number"
                      min={0}
                      value={c.maxPoints}
                      onChange={(e) => update(c.key, { maxPoints: e.target.value })}
                    />
                  )}
                </Field>
                <Button
                  variant="ghost"
                  size="icon"
                  className="mt-7"
                  aria-label={`Remove criterion ${i + 1}`}
                  disabled={criteria.length === 1}
                  onClick={() => setCriteria((cs) => cs.filter((x) => x.key !== c.key))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <Field label="Description">
                {({ id }) => (
                  <Input
                    id={id}
                    value={c.description}
                    onChange={(e) => update(c.key, { description: e.target.value })}
                  />
                )}
              </Field>
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium">Performance levels (optional)</legend>
                <ul className="space-y-2">
                  {c.levels.map((l, li) => (
                    <li key={li} className="flex gap-2">
                      <Input
                        aria-label="Level name"
                        placeholder="e.g. Excellent"
                        value={l.title}
                        onChange={(e) =>
                          update(c.key, {
                            levels: c.levels.map((x, xi) =>
                              xi === li ? { ...x, title: e.target.value } : x,
                            ),
                          })
                        }
                      />
                      <Input
                        aria-label="Level points"
                        type="number"
                        min={0}
                        className="w-28"
                        value={l.points}
                        onChange={(e) =>
                          update(c.key, {
                            levels: c.levels.map((x, xi) =>
                              xi === li ? { ...x, points: e.target.value } : x,
                            ),
                          })
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remove level"
                        onClick={() => update(c.key, { levels: c.levels.filter((_, xi) => xi !== li) })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
                <Button
                  variant="link"
                  className="mt-1 text-sm"
                  onClick={() => update(c.key, { levels: [...c.levels, { title: '', points: c.maxPoints }] })}
                >
                  Add level
                </Button>
              </fieldset>
            </CardBody>
          </Card>
        ))}
        <div className="flex flex-wrap justify-between gap-2">
          <Button
            variant="secondary"
            disabled={criteria.length >= LIMITS.rubricCriteria}
            onClick={() =>
              setCriteria((cs) => [
                ...cs,
                { key: newKey(), title: '', description: '', maxPoints: '5', levels: [] },
              ])
            }
          >
            <Plus className="h-4 w-4" aria-hidden /> Add criterion
          </Button>
          <div className="flex gap-2">
            {rubric && (
              <Button variant="ghost" loading={archive.isPending} onClick={() => archive.mutate()}>
                {rubric.status === 'active' ? 'Archive' : 'Restore'}
              </Button>
            )}
            <Button loading={save.isPending} disabled={!title.trim()} onClick={() => save.mutate()}>
              Save rubric
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
