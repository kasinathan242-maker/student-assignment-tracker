import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from '../../components/ui/icons';
import { useMemo, useState, type ReactNode } from 'react';
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { useBlocker, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  ASSIGNMENT_TYPES,
  DEFAULT_SUBMISSION_EXTENSIONS,
  assignmentCrossFieldIssues,
  createAssignmentSchema,
  updateAssignmentSchema,
  type AssignmentDTO,
  type AssignmentType,
  type CourseDTO,
  type GradeReleaseMode,
  type LatePolicyMode,
  type Paginated,
  type RubricDTO,
  type SectionDTO,
} from '@sat/shared';
import { useOrg } from '../../app/org';
import { useMe } from '../../app/session';
import { Button } from '../../components/ui/button';
import { Alert, ErrorState, SkeletonRows } from '../../components/ui/feedback';
import { Checkbox, Field, FormError, Input, Select, Textarea } from '../../components/ui/form';
import { Card, CardBody, PageHeader } from '../../components/ui/layout';
import { ConfirmDialog } from '../../components/ui/overlay';
import { ApiError, get, patch, post } from '../../lib/api';
import { cn } from '../../lib/cn';
import { browserZone, formatDateTime, fromLocalInput, toLocalInput, TYPE_LABEL } from '../../lib/format';

interface Values {
  courseId: string;
  title: string;
  type: AssignmentType;
  description: string;
  instructions: string;
  objectives: string;
  maxPoints: string;
  rubricId: string;
  timezone: string;
  availableFrom: string;
  dueAt: string;
  availableUntil: string;
  gracePeriodMinutes: string;
  lateMode: LatePolicyMode;
  penaltyPercentPerDay: string;
  maxLateDays: string;
  methodText: boolean;
  methodFile: boolean;
  methodUrl: boolean;
  allowedExtensions: string[];
  maxFiles: string;
  maxFileSizeMb: string;
  resubAllowed: boolean;
  maxAttempts: string;
  extensionsAllowed: boolean;
  gradeRelease: GradeReleaseMode;
  sectionIds: string[];
  changeNote: string;
}

const STEPS = ['Basics', 'Schedule', 'Submissions', 'Review'] as const;
const STEP_FIELDS: Record<(typeof STEPS)[number], (keyof Values)[]> = {
  Basics: ['courseId', 'title', 'type', 'description', 'instructions', 'objectives', 'maxPoints', 'rubricId'],
  Schedule: [
    'timezone',
    'availableFrom',
    'dueAt',
    'availableUntil',
    'gracePeriodMinutes',
    'lateMode',
    'penaltyPercentPerDay',
    'maxLateDays',
  ],
  Submissions: [
    'methodText',
    'methodFile',
    'methodUrl',
    'allowedExtensions',
    'maxFiles',
    'maxFileSizeMb',
    'resubAllowed',
    'maxAttempts',
    'extensionsAllowed',
    'gradeRelease',
    'sectionIds',
  ],
  Review: ['changeNote'],
};

/** Maps API field paths (e.g. "latePolicy.maxLateDays") to form fields. */
const API_TO_FORM: Record<string, keyof Values> = {
  title: 'title',
  type: 'type',
  description: 'description',
  instructions: 'instructions',
  learningObjectives: 'objectives',
  maxPoints: 'maxPoints',
  rubricId: 'rubricId',
  timezone: 'timezone',
  availableFrom: 'availableFrom',
  dueAt: 'dueAt',
  availableUntil: 'availableUntil',
  gracePeriodMinutes: 'gracePeriodMinutes',
  'latePolicy.mode': 'lateMode',
  'latePolicy.penaltyPercentPerDay': 'penaltyPercentPerDay',
  'latePolicy.maxLateDays': 'maxLateDays',
  submissionMethods: 'methodText',
  'fileRules.allowedExtensions': 'allowedExtensions',
  'fileRules.maxFiles': 'maxFiles',
  'fileRules.maxFileSizeMb': 'maxFileSizeMb',
  'resubmission.maxAttempts': 'maxAttempts',
  sectionIds: 'sectionIds',
};

function defaults(timezone: string, courseId: string): Values {
  return {
    courseId,
    title: '',
    type: 'homework',
    description: '',
    instructions: '',
    objectives: '',
    maxPoints: '100',
    rubricId: '',
    timezone,
    availableFrom: '',
    dueAt: '',
    availableUntil: '',
    gracePeriodMinutes: '0',
    lateMode: 'reject',
    penaltyPercentPerDay: '10',
    maxLateDays: '',
    methodText: false,
    methodFile: true,
    methodUrl: false,
    allowedExtensions: [...DEFAULT_SUBMISSION_EXTENSIONS],
    maxFiles: '1',
    maxFileSizeMb: '10',
    resubAllowed: false,
    maxAttempts: '',
    extensionsAllowed: false,
    gradeRelease: 'immediate',
    sectionIds: [],
    changeNote: '',
  };
}

function fromAssignment(a: AssignmentDTO): Values {
  return {
    courseId: a.courseId,
    title: a.title,
    type: a.type,
    description: a.description,
    instructions: a.instructions,
    objectives: a.learningObjectives.join('\n'),
    maxPoints: String(a.maxPoints),
    rubricId: a.rubricId ?? '',
    timezone: a.timezone,
    availableFrom: toLocalInput(a.availableFrom, a.timezone),
    dueAt: toLocalInput(a.dueAt, a.timezone),
    availableUntil: toLocalInput(a.availableUntil, a.timezone),
    gracePeriodMinutes: String(a.gracePeriodMinutes),
    lateMode: a.latePolicy.mode,
    penaltyPercentPerDay: String(a.latePolicy.penaltyPercentPerDay),
    maxLateDays: a.latePolicy.maxLateDays == null ? '' : String(a.latePolicy.maxLateDays),
    methodText: a.submissionMethods.text,
    methodFile: a.submissionMethods.file,
    methodUrl: a.submissionMethods.url,
    allowedExtensions: a.fileRules.allowedExtensions,
    maxFiles: String(a.fileRules.maxFiles),
    maxFileSizeMb: String(a.fileRules.maxFileSizeMb),
    resubAllowed: a.resubmission.allowed,
    maxAttempts: a.resubmission.maxAttempts == null ? '' : String(a.resubmission.maxAttempts),
    extensionsAllowed: a.extensionsAllowed,
    gradeRelease: a.gradeRelease,
    sectionIds: a.sectionIds,
    changeNote: '',
  };
}

const num = (v: string) => (v.trim() === '' ? Number.NaN : Number(v));
const optNum = (v: string) => (v.trim() === '' ? null : Number(v));

/** Converts form values into the API payload. Wall-clock inputs are interpreted in the assignment's time zone. */
function toPayload(v: Values) {
  return {
    title: v.title,
    type: v.type,
    description: v.description,
    instructions: v.instructions,
    learningObjectives: v.objectives
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    maxPoints: num(v.maxPoints),
    rubricId: v.rubricId || null,
    timezone: v.timezone,
    availableFrom: fromLocalInput(v.availableFrom, v.timezone),
    dueAt: fromLocalInput(v.dueAt, v.timezone) ?? '',
    availableUntil: fromLocalInput(v.availableUntil, v.timezone),
    gracePeriodMinutes: num(v.gracePeriodMinutes),
    latePolicy: {
      mode: v.lateMode,
      penaltyPercentPerDay: v.lateMode === 'penalize' ? num(v.penaltyPercentPerDay) : 0,
      maxLateDays: v.lateMode === 'reject' ? null : optNum(v.maxLateDays),
    },
    resubmission: { allowed: v.resubAllowed, maxAttempts: v.resubAllowed ? optNum(v.maxAttempts) : null },
    submissionMethods: { text: v.methodText, file: v.methodFile, url: v.methodUrl },
    fileRules: {
      allowedExtensions: v.allowedExtensions as (typeof ALLOWED_UPLOAD_EXTENSIONS)[number][],
      maxFiles: num(v.maxFiles),
      maxFileSizeMb: num(v.maxFileSizeMb),
    },
    sectionIds: v.sectionIds,
    extensionsAllowed: v.extensionsAllowed,
    gradeRelease: v.gradeRelease,
  };
}

function applyIssues(
  form: UseFormReturn<Values>,
  issues: { path: string; message: string }[],
): (typeof STEPS)[number] | null {
  let firstStep: (typeof STEPS)[number] | null = null;
  for (const issue of issues) {
    const field = API_TO_FORM[issue.path] ?? API_TO_FORM[issue.path.split('.')[0] ?? ''];
    if (!field) continue;
    form.setError(field, { type: 'validate', message: issue.message });
    const step = STEPS.find((s) => STEP_FIELDS[s].includes(field)) ?? null;
    if (!firstStep || (step && STEPS.indexOf(step) < STEPS.indexOf(firstStep))) firstStep = step;
  }
  return firstStep;
}

export function CreateAssignmentPage() {
  const [params] = useSearchParams();
  const me = useMe();
  return (
    <AssignmentWizard
      initial={defaults(me.data?.user.timezone ?? browserZone(), params.get('courseId') ?? '')}
    />
  );
}

export function EditAssignmentPage() {
  const { assignmentId = '' } = useParams();
  const { api } = useOrg();
  const q = useQuery({
    queryKey: ['org', api, 'assignments', assignmentId],
    queryFn: () => get<AssignmentDTO>(`${api}/assignments/${assignmentId}`),
    refetchOnWindowFocus: false,
  });
  if (q.isPending) return <SkeletonRows rows={8} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.canManage)
    return (
      <ErrorState error={new ApiError(403, 'forbidden', 'Only instructors can edit this assignment.')} />
    );
  return <AssignmentWizard initial={fromAssignment(q.data)} existing={q.data} />;
}

function AssignmentWizard({ initial, existing }: { initial: Values; existing?: AssignmentDTO }) {
  const { api, path } = useOrg();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [step, setStep] = useState<(typeof STEPS)[number]>('Basics');
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const form = useForm<Values>({ defaultValues: initial });
  const { register, formState, setValue } = form;
  const v = useWatch({ control: form.control }) as Values;

  const courses = useQuery({
    queryKey: ['org', api, 'courses', { teaching: true }],
    queryFn: () => get<Paginated<CourseDTO>>(`${api}/courses`, { pageSize: 100 }),
  });
  const teaching = (courses.data?.items ?? []).filter(
    (c) => c.myRole === 'instructor' && c.status === 'active',
  );
  const sections = useQuery({
    queryKey: ['org', api, 'courses', v.courseId, 'sections'],
    queryFn: () => get<SectionDTO[]>(`${api}/courses/${v.courseId}/sections`),
    enabled: Boolean(v.courseId),
  });
  const rubrics = useQuery({
    queryKey: ['org', api, 'rubrics', 'list'],
    queryFn: () => get<Paginated<RubricDTO>>(`${api}/rubrics`, { pageSize: 100 }),
  });
  const selectedRubric = rubrics.data?.items.find((r) => r.id === v.rubricId);
  const visibleToStudents = existing && (existing.status === 'published' || existing.status === 'closed');
  const blocker = useBlocker(formState.isDirty && !saved);

  const validate = (): ReturnType<typeof toPayload> | null => {
    form.clearErrors();
    const payload = toPayload(v);
    const issues: { path: string; message: string }[] = [];
    if (!existing && !v.courseId) form.setError('courseId', { message: 'Choose a course' });
    const parsed = createAssignmentSchema.safeParse(payload);
    if (!parsed.success)
      for (const i of parsed.error.issues) issues.push({ path: i.path.join('.'), message: i.message });
    for (const [p, message] of Object.entries(assignmentCrossFieldIssues(payload)))
      issues.push({ path: p, message });
    if (!payload.dueAt) issues.push({ path: 'dueAt', message: 'Choose a due date' });
    const firstStep = applyIssues(form, issues);
    if (firstStep || (!existing && !v.courseId)) {
      setStep(firstStep ?? 'Basics');
      setFormError('Some fields need attention.');
      return null;
    }
    return payload;
  };

  const save = useMutation({
    mutationFn: async ({ publish }: { publish: boolean }) => {
      const payload = validate();
      if (!payload) throw new Error('invalid');
      if (existing) {
        const body = updateAssignmentSchema.parse({
          ...payload,
          expectedRev: existing.rev,
          changeNote: v.changeNote || undefined,
        });
        return patch<AssignmentDTO>(`${api}/assignments/${existing.id}`, body);
      }
      const created = await post<AssignmentDTO>(`${api}/courses/${v.courseId}/assignments`, payload);
      return publish
        ? post<AssignmentDTO>(`${api}/assignments/${created.id}/publish`, { expectedRev: created.rev })
        : created;
    },
    onSuccess: async (a, { publish }) => {
      setSaved(true);
      await qc.invalidateQueries({ queryKey: ['org', api] });
      toast.success(existing ? 'Changes saved.' : publish ? 'Assignment published.' : 'Saved as draft.');
      navigate(path(`/assignments/${a.id}`), { replace: true });
    },
    onError: (e) => {
      if (e instanceof Error && e.message === 'invalid') return;
      if (e instanceof ApiError) {
        const s = applyIssues(
          form,
          Object.entries(e.fields).map(([p, m]) => ({ path: p, message: m[0] ?? '' })),
        );
        if (s) setStep(s);
        setFormError(
          e.code === 'stale_revision'
            ? 'Someone else changed this assignment. Reload the page to see their changes before saving.'
            : e.message,
        );
      } else setFormError('Saving failed. Your changes are still here; try again.');
    },
  });

  const err = (k: keyof Values) => formState.errors[k]?.message;
  const stepIndex = STEPS.indexOf(step);
  const stepHasError = (s: (typeof STEPS)[number]) => STEP_FIELDS[s].some((f) => formState.errors[f]);
  const extToggle = (ext: string, on: boolean) =>
    setValue(
      'allowedExtensions',
      on ? [...new Set([...v.allowedExtensions, ext])] : v.allowedExtensions.filter((e) => e !== ext),
      { shouldDirty: true },
    );
  const dueIso = useMemo(() => fromLocalInput(v.dueAt, v.timezone), [v.dueAt, v.timezone]);

  return (
    <div className="max-w-4xl">
      <PageHeader
        breadcrumbs={[
          { label: 'Assignments', to: path('/assignments') },
          ...(existing ? [{ label: existing.title, to: path(`/assignments/${existing.id}`) }] : []),
          { label: existing ? 'Edit' : 'New' },
        ]}
        title={existing ? `Edit: ${existing.title}` : 'New assignment'}
      />
      <ol className="mb-6 grid grid-cols-4 gap-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => setStep(s)}
              aria-current={step === s ? 'step' : undefined}
              className={cn(
                'flex w-full items-center gap-2 border-t-2 pt-2 text-left text-sm font-medium',
                step === s
                  ? 'border-accent text-fg'
                  : i < stepIndex
                    ? 'border-accent/50 text-fg-muted'
                    : 'border-border text-fg-muted',
                stepHasError(s) && 'border-danger text-danger',
              )}
            >
              {i < stepIndex && !stepHasError(s) ? (
                <Check className="h-4 w-4" aria-hidden />
              ) : (
                <span className="tabular">{i + 1}.</span>
              )}
              {s}
              {stepHasError(s) && <span className="sr-only"> (has errors)</span>}
            </button>
          </li>
        ))}
      </ol>
      <FormError message={formError} />
      {visibleToStudents && (
        <Alert tone="warning" className="my-4">
          Students can already see this assignment. Changes to deadlines and requirements are recorded and
          students are notified.
        </Alert>
      )}

      <form className="mt-4" noValidate onSubmit={(e) => e.preventDefault()}>
        <Card>
          <CardBody className="space-y-5">
            {step === 'Basics' && (
              <>
                {!existing && (
                  <Field label="Course" required error={err('courseId')}>
                    {({ id, invalid }) => (
                      <Select id={id} aria-invalid={invalid} {...register('courseId')}>
                        <option value="">Choose a course you teach</option>
                        {teaching.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.code} · {c.title}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                )}
                <Field label="Title" required error={err('title')}>
                  {({ id, invalid }) => <Input id={id} aria-invalid={invalid} {...register('title')} />}
                </Field>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Type">
                    {({ id }) => (
                      <Select id={id} {...register('type')}>
                        {ASSIGNMENT_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {TYPE_LABEL[t]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field
                    label="Points"
                    required
                    error={err('maxPoints')}
                    hint={selectedRubric ? `Rubric total: ${selectedRubric.totalPoints}` : undefined}
                  >
                    {({ id, invalid, describedBy }) => (
                      <Input
                        id={id}
                        type="number"
                        min={0}
                        step="0.5"
                        aria-invalid={invalid}
                        aria-describedby={describedBy}
                        {...register('maxPoints')}
                      />
                    )}
                  </Field>
                  <Field label="Rubric" error={err('rubricId')}>
                    {({ id }) => (
                      <Select id={id} {...register('rubricId')}>
                        <option value="">No rubric</option>
                        {rubrics.data?.items.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.title} ({r.totalPoints} pts)
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </div>
                {selectedRubric && Number(v.maxPoints) !== selectedRubric.totalPoints && (
                  <Button
                    variant="link"
                    className="text-sm"
                    onClick={() =>
                      setValue('maxPoints', String(selectedRubric.totalPoints), { shouldDirty: true })
                    }
                  >
                    Use the rubric total ({selectedRubric.totalPoints}) as the points value
                  </Button>
                )}
                <Field label="Summary" hint="One or two sentences shown in lists." error={err('description')}>
                  {({ id, describedBy }) => (
                    <Textarea
                      id={id}
                      className="min-h-16"
                      aria-describedby={describedBy}
                      {...register('description')}
                    />
                  )}
                </Field>
                <Field
                  label="Instructions"
                  hint="Markdown supported: **bold**, lists, links and code."
                  error={err('instructions')}
                >
                  {({ id, describedBy }) => (
                    <Textarea
                      id={id}
                      className="min-h-40 font-mono text-[0.8125rem]"
                      aria-describedby={describedBy}
                      {...register('instructions')}
                    />
                  )}
                </Field>
                <Field label="Learning objectives" hint="One per line." error={err('objectives')}>
                  {({ id, describedBy }) => (
                    <Textarea
                      id={id}
                      className="min-h-20"
                      aria-describedby={describedBy}
                      {...register('objectives')}
                    />
                  )}
                </Field>
              </>
            )}

            {step === 'Schedule' && (
              <>
                <Field
                  label="Time zone"
                  required
                  hint="Dates below are entered and shown in this time zone. Students see them in their own time zone."
                  error={err('timezone')}
                >
                  {({ id, describedBy, invalid }) => (
                    <Select
                      id={id}
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                      {...register('timezone')}
                    >
                      {Intl.supportedValuesOf('timeZone').map((z) => (
                        <option key={z} value={z}>
                          {z}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Opens (optional)" hint="Blank: open on publish." error={err('availableFrom')}>
                    {({ id, describedBy, invalid }) => (
                      <Input
                        id={id}
                        type="datetime-local"
                        aria-describedby={describedBy}
                        aria-invalid={invalid}
                        {...register('availableFrom')}
                      />
                    )}
                  </Field>
                  <Field label="Due" required error={err('dueAt')}>
                    {({ id, invalid }) => (
                      <Input id={id} type="datetime-local" aria-invalid={invalid} {...register('dueAt')} />
                    )}
                  </Field>
                  <Field
                    label="Closes (optional)"
                    hint="Hard stop for late work."
                    error={err('availableUntil')}
                  >
                    {({ id, describedBy, invalid }) => (
                      <Input
                        id={id}
                        type="datetime-local"
                        aria-describedby={describedBy}
                        aria-invalid={invalid}
                        {...register('availableUntil')}
                      />
                    )}
                  </Field>
                </div>
                {dueIso && <p className="text-sm text-fg-muted">Due {formatDateTime(dueIso, v.timezone)}.</p>}
                <Field
                  label="Grace period (minutes)"
                  hint="Submissions within this window after the due time are not marked late."
                  error={err('gracePeriodMinutes')}
                >
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      type="number"
                      min={0}
                      max={1440}
                      className="sm:w-40"
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                      {...register('gracePeriodMinutes')}
                    />
                  )}
                </Field>
                <fieldset className="space-y-3">
                  <legend className="text-sm font-medium">Late submissions</legend>
                  {(
                    [
                      ['reject', 'Do not accept late work'],
                      ['accept', 'Accept late work, marked late'],
                      ['penalize', 'Accept late work with a penalty'],
                    ] as const
                  ).map(([value, label]) => (
                    <label key={value} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        value={value}
                        className="accent-[var(--accent)]"
                        {...register('lateMode')}
                      />{' '}
                      {label}
                    </label>
                  ))}
                  {v.lateMode !== 'reject' && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      {v.lateMode === 'penalize' && (
                        <Field label="Penalty per day late (%)" error={err('penaltyPercentPerDay')}>
                          {({ id, invalid }) => (
                            <Input
                              id={id}
                              type="number"
                              min={0}
                              max={100}
                              aria-invalid={invalid}
                              {...register('penaltyPercentPerDay')}
                            />
                          )}
                        </Field>
                      )}
                      <Field
                        label="Accept for up to (days)"
                        hint="Blank: no limit (unless the close date applies)."
                        error={err('maxLateDays')}
                      >
                        {({ id, describedBy, invalid }) => (
                          <Input
                            id={id}
                            type="number"
                            min={0}
                            max={365}
                            aria-describedby={describedBy}
                            aria-invalid={invalid}
                            {...register('maxLateDays')}
                          />
                        )}
                      </Field>
                    </div>
                  )}
                </fieldset>
              </>
            )}

            {step === 'Submissions' && (
              <>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Students can submit</legend>
                  <Checkbox label="A written response" {...register('methodText')} />
                  <Checkbox label="Files" {...register('methodFile')} />
                  <Checkbox label="A link (URL)" {...register('methodUrl')} />
                  {formState.errors.methodText && (
                    <p className="text-sm text-danger" role="alert">
                      {formState.errors.methodText.message}
                    </p>
                  )}
                </fieldset>
                {v.methodFile && (
                  <div className="space-y-4 rounded-[var(--radius-control)] border border-border p-4">
                    <fieldset>
                      <legend className="mb-2 text-sm font-medium">Accepted file types</legend>
                      <div className="flex flex-wrap gap-2">
                        {ALLOWED_UPLOAD_EXTENSIONS.map((ext) => (
                          <label
                            key={ext}
                            className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-sm has-checked:border-accent has-checked:bg-accent-soft"
                          >
                            <input
                              type="checkbox"
                              className="accent-[var(--accent)]"
                              checked={v.allowedExtensions.includes(ext)}
                              onChange={(e) => extToggle(ext, e.target.checked)}
                            />
                            .{ext}
                          </label>
                        ))}
                      </div>
                      {err('allowedExtensions') && (
                        <p className="mt-1 text-sm text-danger" role="alert">
                          {err('allowedExtensions')}
                        </p>
                      )}
                    </fieldset>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Maximum files" error={err('maxFiles')}>
                        {({ id, invalid }) => (
                          <Input
                            id={id}
                            type="number"
                            min={1}
                            max={20}
                            aria-invalid={invalid}
                            {...register('maxFiles')}
                          />
                        )}
                      </Field>
                      <Field label="Maximum size per file (MB)" error={err('maxFileSizeMb')}>
                        {({ id, invalid }) => (
                          <Input
                            id={id}
                            type="number"
                            min={1}
                            max={100}
                            aria-invalid={invalid}
                            {...register('maxFileSizeMb')}
                          />
                        )}
                      </Field>
                    </div>
                  </div>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Checkbox
                      label="Allow resubmission"
                      description="Students may submit again before the deadline."
                      {...register('resubAllowed')}
                    />
                    {v.resubAllowed && (
                      <Field label="Maximum attempts" hint="Blank: unlimited." error={err('maxAttempts')}>
                        {({ id, describedBy, invalid }) => (
                          <Input
                            id={id}
                            type="number"
                            min={1}
                            max={50}
                            aria-describedby={describedBy}
                            aria-invalid={invalid}
                            {...register('maxAttempts')}
                          />
                        )}
                      </Field>
                    )}
                  </div>
                  <Checkbox
                    label="Allow extension requests"
                    description="Students can ask for more time; you approve or decline."
                    {...register('extensionsAllowed')}
                  />
                </div>
                <Field label="Grade release" hint="Hold grades to release them to everyone at once.">
                  {({ id, describedBy }) => (
                    <Select id={id} aria-describedby={describedBy} {...register('gradeRelease')}>
                      <option value="immediate">Show each grade when I publish it</option>
                      <option value="hold">Hold grades until I release them all</option>
                    </Select>
                  )}
                </Field>
                {(sections.data?.length ?? 0) > 0 && (
                  <fieldset>
                    <legend className="mb-2 text-sm font-medium">Assign to</legend>
                    <p className="mb-2 text-sm text-fg-muted">
                      Leave all unchecked to assign to the whole course.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      {sections.data
                        ?.filter((s) => s.status === 'active')
                        .map((s) => (
                          <Checkbox
                            key={s.id}
                            label={s.name}
                            checked={v.sectionIds.includes(s.id)}
                            onChange={(e) =>
                              setValue(
                                'sectionIds',
                                e.target.checked
                                  ? [...v.sectionIds, s.id]
                                  : v.sectionIds.filter((x) => x !== s.id),
                                { shouldDirty: true },
                              )
                            }
                          />
                        ))}
                    </div>
                  </fieldset>
                )}
              </>
            )}

            {step === 'Review' && (
              <>
                <ReviewRow label="Title">{v.title || <span className="text-danger">Missing</span>}</ReviewRow>
                <ReviewRow label="Course">
                  {existing
                    ? existing.courseCode
                    : (teaching.find((c) => c.id === v.courseId)?.code ?? (
                        <span className="text-danger">Not selected</span>
                      ))}
                </ReviewRow>
                <ReviewRow label="Due">
                  {dueIso ? formatDateTime(dueIso, v.timezone) : <span className="text-danger">Missing</span>}
                </ReviewRow>
                <ReviewRow label="Points">{v.maxPoints}</ReviewRow>
                <ReviewRow label="Submit as">
                  {[
                    v.methodText && 'written response',
                    v.methodFile && `files (${v.allowedExtensions.join(', ')})`,
                    v.methodUrl && 'link',
                  ]
                    .filter(Boolean)
                    .join(', ') || 'None selected'}
                </ReviewRow>
                <ReviewRow label="Late work">
                  {v.lateMode === 'reject'
                    ? 'Not accepted'
                    : v.lateMode === 'accept'
                      ? 'Accepted, marked late'
                      : `${v.penaltyPercentPerDay}% penalty per day`}
                </ReviewRow>
                <ReviewRow label="Recipients">
                  {v.sectionIds.length ? `${v.sectionIds.length} section(s)` : 'Whole course'}
                </ReviewRow>
                {existing && (
                  <Field label="Note about this change (optional)" hint="Recorded in the change history.">
                    {({ id, describedBy }) => (
                      <Input
                        id={id}
                        aria-describedby={describedBy}
                        maxLength={1000}
                        {...register('changeNote')}
                      />
                    )}
                  </Field>
                )}
              </>
            )}
          </CardBody>
        </Card>
        <div className="mt-4 flex flex-wrap justify-between gap-2">
          <Button
            variant="secondary"
            disabled={stepIndex === 0}
            onClick={() => setStep(STEPS[stepIndex - 1] ?? 'Basics')}
          >
            Back
          </Button>
          <div className="flex flex-wrap gap-2">
            {step !== 'Review' && (
              <Button variant="secondary" onClick={() => setStep(STEPS[stepIndex + 1] ?? 'Review')}>
                Next
              </Button>
            )}
            {existing ? (
              <Button loading={save.isPending} onClick={() => save.mutate({ publish: false })}>
                Save changes
              </Button>
            ) : (
              <>
                <Button
                  variant="secondary"
                  loading={save.isPending && !save.variables?.publish}
                  disabled={save.isPending}
                  onClick={() => save.mutate({ publish: false })}
                >
                  Save as draft
                </Button>
                {step === 'Review' && (
                  <Button
                    loading={save.isPending && save.variables?.publish}
                    disabled={save.isPending}
                    onClick={() => save.mutate({ publish: true })}
                  >
                    Publish
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </form>
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(o) => !o && blocker.reset?.()}
        title="Discard unsaved changes?"
        description="You have changes that have not been saved."
        confirmLabel="Discard"
        tone="danger"
        onConfirm={() => blocker.proceed?.()}
      />
    </div>
  );
}

function ReviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border pb-3 text-sm sm:grid-cols-[10rem_1fr]">
      <span className="text-fg-muted">{label}</span>
      <span>{children}</span>
    </div>
  );
}
