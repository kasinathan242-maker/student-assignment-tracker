import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Download, Plus, Upload, Users } from '../../components/ui/icons';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  LIMITS,
  emailSchema,
  type AssignmentDTO,
  type CourseDTO,
  type CourseReportDTO,
  type DepartmentDTO,
  type EnrollmentDTO,
  type Paginated,
  type RosterImportPreviewDTO,
  type SectionDTO,
} from '@sat/shared';
import { useOrg } from '../../app/org';
import { Button, ButtonLink } from '../../components/ui/button';
import {
  Alert,
  AssignmentStatusBadge,
  Badge,
  EmptyState,
  ErrorState,
  SkeletonRows,
} from '../../components/ui/feedback';
import { Field, FormError, Input, Select, Textarea } from '../../components/ui/form';
import {
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Pagination,
  TabPanel,
  Table,
  Tabs,
  Td,
  Th,
} from '../../components/ui/layout';
import { ConfirmDialog, Dialog } from '../../components/ui/overlay';
import { ApiError, downloadUrl, get, patch, post } from '../../lib/api';
import { applyServerErrors } from '../../lib/forms';
import { formatDate, formatShort } from '../../lib/format';
import { useDebounced } from '../../lib/useDebounced';

const courseForm = z.object({
  code: z.string().trim().min(1, 'Required').max(LIMITS.courseCode),
  title: z.string().trim().min(1, 'Required').max(LIMITS.courseTitle),
  term: z.string().trim().min(1, 'Required').max(LIMITS.term),
  description: z.string().trim().max(LIMITS.courseDescription),
  departmentId: z.string(),
});
type CourseFormValues = z.input<typeof courseForm>;

function CourseFormDialog({
  open,
  onOpenChange,
  course,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  course?: CourseDTO;
}) {
  const { api } = useOrg();
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const departments = useQuery({
    queryKey: ['org', api, 'departments'],
    queryFn: () => get<DepartmentDTO[]>(`${api}/departments`),
    enabled: open,
  });
  const form = useForm<CourseFormValues>({
    resolver: zodResolver(courseForm),
    values: {
      code: course?.code ?? '',
      title: course?.title ?? '',
      term: course?.term ?? '',
      description: course?.description ?? '',
      departmentId: course?.departmentId ?? '',
    },
  });
  const save = useMutation({
    mutationFn: (v: CourseFormValues) => {
      const body = { ...v, departmentId: v.departmentId || null };
      return course
        ? patch<CourseDTO>(`${api}/courses/${course.id}`, body)
        : post<CourseDTO>(`${api}/courses`, body);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['org', api, 'courses'] });
      toast.success(course ? 'Course updated.' : 'Course created.');
      onOpenChange(false);
    },
    onError: (e) => setFormError(applyServerErrors(form, e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={course ? 'Edit course' : 'Create course'}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="course-form" loading={save.isPending}>
            {course ? 'Save changes' : 'Create course'}
          </Button>
        </>
      }
    >
      <form
        id="course-form"
        className="space-y-4"
        noValidate
        onSubmit={form.handleSubmit((v) => save.mutate(v))}
      >
        <FormError message={formError} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Course code" required error={form.formState.errors.code?.message}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                className="uppercase"
                aria-describedby={describedBy}
                aria-invalid={invalid}
                {...form.register('code')}
              />
            )}
          </Field>
          <Field
            label="Term"
            required
            hint="For example 2026 Monsoon"
            error={form.formState.errors.term?.message}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                {...form.register('term')}
              />
            )}
          </Field>
        </div>
        <Field label="Title" required error={form.formState.errors.title?.message}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...form.register('title')}
            />
          )}
        </Field>
        <Field label="Department">
          {({ id }) => (
            <Select id={id} {...form.register('departmentId')}>
              <option value="">None</option>
              {departments.data
                ?.filter((d) => d.status === 'active')
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} · {d.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label="Description" error={form.formState.errors.description?.message}>
          {({ id, describedBy }) => (
            <Textarea id={id} aria-describedby={describedBy} {...form.register('description')} />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

export function CourseListPage() {
  const { api, path, role } = useOrg();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const search = useDebounced(q, 300);
  const scope = role === 'org_admin' && params.get('scope') === 'all' ? 'all' : 'mine';
  const status = params.get('status') === 'archived' ? 'archived' : 'active';
  const page = Number(params.get('page') ?? 1);
  const [creating, setCreating] = useState(false);
  const courses = useQuery({
    queryKey: ['org', api, 'courses', { scope, status, search, page }],
    queryFn: () =>
      get<Paginated<CourseDTO>>(`${api}/courses`, { scope, status, q: search, page, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  return (
    <div>
      <PageHeader
        title="Courses"
        description={
          scope === 'all'
            ? 'Every course in the organization.'
            : role === 'student'
              ? 'Courses you are enrolled in.'
              : 'Courses you teach or take.'
        }
        actions={
          role !== 'student' && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden /> New course
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Search" className="sm:w-72">
          {({ id }) => (
            <Input
              id={id}
              type="search"
              placeholder="Code or title"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          )}
        </Field>
        {role === 'org_admin' && (
          <Field label="Show" className="sm:w-48">
            {({ id }) => (
              <Select
                id={id}
                value={scope}
                onChange={(e) => set('scope', e.target.value === 'all' ? 'all' : null)}
              >
                <option value="mine">My courses</option>
                <option value="all">All courses</option>
              </Select>
            )}
          </Field>
        )}
        <Field label="Status" className="sm:w-40">
          {({ id }) => (
            <Select
              id={id}
              value={status}
              onChange={(e) => set('status', e.target.value === 'archived' ? 'archived' : null)}
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </Select>
          )}
        </Field>
      </div>
      {courses.isPending && <SkeletonRows />}
      {courses.error && <ErrorState error={courses.error} onRetry={() => void courses.refetch()} />}
      {courses.data && courses.data.items.length === 0 && (
        <EmptyState
          icon={BookOpen}
          title={search ? 'No courses match your search' : 'No courses yet'}
          description={
            role === 'student'
              ? 'Your teachers will add you to courses.'
              : 'Create a course to start publishing assignments.'
          }
        />
      )}
      {courses.data && courses.data.items.length > 0 && (
        <>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {courses.data.items.map((c) => (
              <li key={c.id}>
                <Link
                  to={path(`/courses/${c.id}`)}
                  className="block h-full rounded-[var(--radius-card)] border border-border bg-surface p-4 hover:border-border-strong hover:bg-surface-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-sm font-semibold text-accent">{c.code}</span>
                    {c.myRole && (
                      <Badge tone={c.myRole === 'instructor' ? 'accent' : 'neutral'}>
                        {c.myRole === 'instructor' ? 'Teaching' : 'Enrolled'}
                      </Badge>
                    )}
                  </div>
                  <h2 className="mt-1 font-semibold">{c.title}</h2>
                  <p className="mt-1 text-sm text-fg-muted">
                    {c.term}
                    {c.departmentName ? ` · ${c.departmentName}` : ''}
                  </p>
                  <p className="mt-3 text-sm text-fg-muted">
                    {c.instructors.map((i) => i.name).join(', ') || 'No instructor'} ·{' '}
                    <span className="tabular">{c.studentCount}</span> students
                  </p>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination
            page={courses.data.page}
            totalPages={courses.data.totalPages}
            total={courses.data.total}
            onPage={(p) => set('page', String(p))}
          />
        </>
      )}
      <CourseFormDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

export function CourseDetailPage() {
  const { courseId = '' } = useParams();
  const { api, path, role } = useOrg();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  const course = useQuery({
    queryKey: ['org', api, 'courses', courseId],
    queryFn: () => get<CourseDTO>(`${api}/courses/${courseId}`),
  });
  if (course.isPending) return <SkeletonRows rows={6} />;
  if (course.error) return <ErrorState error={course.error} onRetry={() => void course.refetch()} />;
  const c = course.data;
  const manage = c.myRole === 'instructor' || role === 'org_admin';
  const teach = c.myRole === 'instructor';
  const tabs = [
    { value: 'overview', label: 'Assignments' },
    ...(manage
      ? [
          { value: 'roster', label: 'Roster' },
          { value: 'sections', label: 'Sections' },
        ]
      : []),
    ...(teach ? [{ value: 'report', label: 'Report' }] : []),
    ...(manage ? [{ value: 'settings', label: 'Settings' }] : []),
  ];
  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Courses', to: path('/courses') }, { label: c.code }]}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {c.code} · {c.title} {c.status === 'archived' && <Badge>Archived</Badge>}
          </span>
        }
        description={`${c.term}${c.departmentName ? ` · ${c.departmentName}` : ''} · Taught by ${c.instructors.map((i) => i.name).join(', ') || 'no instructor yet'}`}
        actions={
          teach &&
          c.status === 'active' && (
            <ButtonLink to={path(`/assignments/new?courseId=${c.id}`)} variant="primary">
              <Plus className="h-4 w-4" aria-hidden /> New assignment
            </ButtonLink>
          )
        }
      />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })} tabs={tabs}>
        <TabPanel value="overview">
          {c.description && <p className="mb-4 max-w-[72ch] text-sm text-fg-muted">{c.description}</p>}
          <CourseAssignments course={c} />
        </TabPanel>
        {manage && (
          <TabPanel value="roster">
            <Roster course={c} />
          </TabPanel>
        )}
        {manage && (
          <TabPanel value="sections">
            <Sections course={c} />
          </TabPanel>
        )}
        {teach && (
          <TabPanel value="report">
            <CourseReport course={c} />
          </TabPanel>
        )}
        {manage && (
          <TabPanel value="settings">
            <CourseSettings course={c} />
          </TabPanel>
        )}
      </Tabs>
    </div>
  );
}

function CourseAssignments({ course }: { course: CourseDTO }) {
  const { api, path } = useOrg();
  const q = useQuery({
    queryKey: ['org', api, 'assignments', { courseId: course.id }],
    queryFn: () =>
      get<Paginated<AssignmentDTO>>(`${api}/courses/${course.id}/assignments`, { pageSize: 100 }),
  });
  if (q.isPending) return <SkeletonRows />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (q.data.items.length === 0)
    return (
      <EmptyState
        title="No assignments yet"
        description={
          course.myRole === 'instructor'
            ? 'Create the first assignment for this course.'
            : 'Published assignments will appear here.'
        }
      />
    );
  return (
    <Table caption={`Assignments in ${course.code}`}>
      <thead>
        <tr>
          <Th>Title</Th>
          <Th>Due</Th>
          <Th>Points</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {q.data.items.map((a) => (
          <tr key={a.id}>
            <Td>
              <Link to={path(`/assignments/${a.id}`)} className="font-medium hover:underline">
                {a.title}
              </Link>
            </Td>
            <Td className="tabular whitespace-nowrap">{formatShort(a.my?.effectiveDueAt ?? a.dueAt)}</Td>
            <Td className="tabular">{a.maxPoints}</Td>
            <Td>
              {a.my ? (
                <span className="text-sm">{a.my.displayStatus.replace('_', ' ')}</span>
              ) : (
                <AssignmentStatusBadge status={a.status} />
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

const addForm = z.object({
  email: emailSchema,
  role: z.enum(['student', 'instructor']),
  sectionId: z.string(),
});

function Roster({ course }: { course: CourseDTO }) {
  const { api, role: orgRole } = useOrg();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const search = useDebounced(q, 300);
  const [page, setPage] = useState(1);
  const [roleFilter, setRoleFilter] = useState('');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dropping, setDropping] = useState<EnrollmentDTO | null>(null);
  const sections = useQuery({
    queryKey: ['org', api, 'courses', course.id, 'sections'],
    queryFn: () => get<SectionDTO[]>(`${api}/courses/${course.id}/sections`),
  });
  const roster = useQuery({
    queryKey: ['org', api, 'courses', course.id, 'roster', { search, page, roleFilter }],
    queryFn: () =>
      get<Paginated<EnrollmentDTO>>(`${api}/courses/${course.id}/roster`, {
        q: search,
        page,
        role: roleFilter || undefined,
        pageSize: 25,
      }),
    placeholderData: keepPreviousData,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['org', api, 'courses', course.id] });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      patch(`${api}/courses/${course.id}/enrollments/${id}`, body),
    onSuccess: async () => {
      await invalidate();
      toast.success('Enrollment updated.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Update failed.'),
  });
  const form = useForm<z.input<typeof addForm>>({
    resolver: zodResolver(addForm),
    defaultValues: { email: '', role: 'student', sectionId: '' },
  });
  const [formError, setFormError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: (v: z.input<typeof addForm>) =>
      post<{ invited: boolean }>(`${api}/courses/${course.id}/enrollments`, {
        email: v.email,
        role: v.role,
        sectionId: v.sectionId || null,
      }),
    onSuccess: async (res) => {
      await invalidate();
      toast.success(
        res.invited ? 'Invitation sent. They will join the course when they accept.' : 'Added to the course.',
      );
      form.reset();
      setAdding(false);
    },
    onError: (e) => setFormError(applyServerErrors(form, e)),
  });
  const archived = course.status === 'archived';

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Search roster" className="sm:w-64">
            {({ id }) => (
              <Input
                id={id}
                type="search"
                placeholder="Name or email"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            )}
          </Field>
          <Field label="Role" className="sm:w-40">
            {({ id }) => (
              <Select
                id={id}
                value={roleFilter}
                onChange={(e) => {
                  setRoleFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Everyone</option>
                <option value="student">Students</option>
                <option value="instructor">Instructors</option>
              </Select>
            )}
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            className="inline-flex h-9.5 items-center gap-2 rounded-[var(--radius-control)] border border-border-strong px-4 text-sm font-medium hover:bg-surface-2"
            href={downloadUrl(`${api}/courses/${course.id}/roster.csv`)}
          >
            <Download className="h-4 w-4" aria-hidden /> Export CSV
          </a>
          <Button variant="secondary" disabled={archived} onClick={() => setImporting(true)}>
            <Upload className="h-4 w-4" aria-hidden /> Import CSV
          </Button>
          <Button disabled={archived} onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Add people
          </Button>
        </div>
      </div>
      {roster.isPending && <SkeletonRows />}
      {roster.error && <ErrorState error={roster.error} onRetry={() => void roster.refetch()} />}
      {roster.data && roster.data.items.length === 0 && (
        <EmptyState
          icon={Users}
          title="No one here yet"
          description="Add students by email. People without an account receive an invitation."
        />
      )}
      {roster.data && roster.data.items.length > 0 && (
        <>
          <Table caption="Course roster">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Section</Th>
                <Th>Enrolled</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {roster.data.items.map((e) => (
                <tr key={e.id}>
                  <Td className="font-medium">
                    {e.name}
                    {e.studentNumber && (
                      <span className="block text-xs font-normal text-fg-muted">{e.studentNumber}</span>
                    )}
                  </Td>
                  <Td className="text-fg-muted">{e.email}</Td>
                  <Td>{e.role === 'instructor' ? <Badge tone="accent">Instructor</Badge> : 'Student'}</Td>
                  <Td>
                    {e.role === 'student' ? (
                      <Select
                        aria-label={`Section for ${e.name}`}
                        className="h-8 w-40"
                        value={e.sectionId ?? ''}
                        disabled={archived || update.isPending}
                        onChange={(ev) =>
                          update.mutate({ id: e.id, body: { sectionId: ev.target.value || null } })
                        }
                      >
                        <option value="">No section</option>
                        {sections.data
                          ?.filter((s) => s.status === 'active')
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                      </Select>
                    ) : (
                      'n/a'
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">{formatDate(e.enrolledAt)}</Td>
                  <Td className="text-right">
                    <Button variant="ghost" size="sm" disabled={archived} onClick={() => setDropping(e)}>
                      Remove
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            page={roster.data.page}
            totalPages={roster.data.totalPages}
            total={roster.data.total}
            onPage={setPage}
          />
        </>
      )}

      <Dialog
        open={adding}
        onOpenChange={(o) => {
          setAdding(o);
          setFormError(null);
        }}
        title="Add people"
        description="Organization members are added immediately. Anyone else receives an email invitation to join this course."
        footer={
          <Button type="submit" form="add-enrollment" loading={add.isPending}>
            Add
          </Button>
        }
      >
        <form
          id="add-enrollment"
          className="space-y-4"
          noValidate
          onSubmit={form.handleSubmit((v) => add.mutate(v))}
        >
          <FormError message={formError} />
          <Field label="Email" required error={form.formState.errors.email?.message}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="email"
                aria-describedby={describedBy}
                aria-invalid={invalid}
                {...form.register('email')}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Role">
              {({ id }) => (
                <Select id={id} {...form.register('role')}>
                  <option value="student">Student</option>
                  <option value="instructor">Co-instructor</option>
                </Select>
              )}
            </Field>
            <Field label="Section">
              {({ id }) => (
                <Select id={id} {...form.register('sectionId')}>
                  <option value="">No section</option>
                  {sections.data?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </form>
      </Dialog>

      <RosterImportDialog
        course={course}
        open={importing}
        onOpenChange={setImporting}
        canImportInstructors={orgRole === 'org_admin'}
      />

      <ConfirmDialog
        open={dropping != null}
        onOpenChange={(o) => !o && setDropping(null)}
        title={`Remove ${dropping?.name ?? ''} from ${course.code}?`}
        description="They lose access to this course. Their submissions and grades are kept, and you can re-add them later."
        confirmLabel="Remove"
        tone="danger"
        pending={update.isPending}
        onConfirm={() =>
          dropping &&
          update.mutate(
            { id: dropping.id, body: { status: 'dropped' } },
            { onSuccess: () => setDropping(null) },
          )
        }
      />
    </div>
  );
}

function RosterImportDialog({
  course,
  open,
  onOpenChange,
  canImportInstructors,
}: {
  course: CourseDTO;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  canImportInstructors: boolean;
}) {
  const { api } = useOrg();
  const qc = useQueryClient();
  const [csv, setCsv] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RosterImportPreviewDTO | null>(null);
  const reset = () => {
    setCsv('');
    setPreview(null);
    setFileError(null);
  };
  const runPreview = useMutation({
    mutationFn: (content: string) =>
      post<RosterImportPreviewDTO>(`${api}/courses/${course.id}/roster-import/preview`, { csv: content }),
    onSuccess: setPreview,
    onError: (e) => setFileError(e instanceof ApiError ? e.message : 'The file could not be checked.'),
  });
  const commit = useMutation({
    mutationFn: () =>
      post<{ enroll: number; invite: number }>(`${api}/courses/${course.id}/roster-import/commit`, {
        csv,
        contentHash: preview?.contentHash,
      }),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['org', api, 'courses', course.id] });
      toast.success(`Import complete: ${res.enroll} enrolled, ${res.invite} invited.`);
      reset();
      onOpenChange(false);
    },
    onError: (e) => setFileError(e instanceof ApiError ? e.message : 'Import failed. Nothing was changed.'),
  });
  return (
    <Dialog
      wide
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      title="Import roster from CSV"
      description={`Columns: email (required), name, role (student${canImportInstructors ? ' or instructor' : ''}), section. Nothing changes until you confirm the preview.`}
      footer={
        preview ? (
          <>
            <Button variant="secondary" onClick={() => setPreview(null)}>
              Choose another file
            </Button>
            <Button
              loading={commit.isPending}
              disabled={preview.summary.errors > 0 || preview.summary.enroll + preview.summary.invite === 0}
              onClick={() => commit.mutate()}
            >
              Import {preview.summary.enroll + preview.summary.invite} rows
            </Button>
          </>
        ) : undefined
      }
    >
      {fileError && <FormError message={fileError} />}
      {!preview && (
        <Field label="CSV file" hint="Maximum 1 MB and 2,000 rows.">
          {({ id, describedBy }) => (
            <Input
              id={id}
              type="file"
              accept=".csv,text/csv"
              aria-describedby={describedBy}
              className="h-auto py-2"
              onChange={async (e) => {
                setFileError(null);
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > LIMITS.csvImportBytes) {
                  setFileError('The file is larger than 1 MB.');
                  return;
                }
                const content = await file.text();
                setCsv(content);
                runPreview.mutate(content);
              }}
            />
          )}
        </Field>
      )}
      {runPreview.isPending && <SkeletonRows rows={3} />}
      {preview && (
        <div className="space-y-3">
          <p className="text-sm">
            <strong>{preview.summary.enroll}</strong> will be enrolled,{' '}
            <strong>{preview.summary.invite}</strong> invited, <strong>{preview.summary.skipped}</strong>{' '}
            skipped, <strong>{preview.summary.errors}</strong> with errors.
          </p>
          {preview.summary.errors > 0 && (
            <Alert tone="danger">
              Fix the rows marked as errors in your file and choose it again. Rows are never imported
              silently.
            </Alert>
          )}
          <div className="max-h-80 overflow-auto rounded-[var(--radius-control)] border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">Import preview</caption>
              <thead className="sticky top-0 bg-surface-2">
                <tr className="text-left text-xs text-fg-muted">
                  <th scope="col" className="px-2 py-1.5">
                    Line
                  </th>
                  <th scope="col" className="px-2 py-1.5">
                    Email
                  </th>
                  <th scope="col" className="px-2 py-1.5">
                    Outcome
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line} className="border-t border-border">
                    <td className="tabular px-2 py-1.5">{r.line}</td>
                    <td className="px-2 py-1.5">{r.email}</td>
                    <td className="px-2 py-1.5">
                      {r.action === 'error' ? (
                        <span className="text-danger">{r.errors.join('; ')}</span>
                      ) : (
                        {
                          enroll: 'Enroll',
                          invite: 'Invite by email',
                          skip_duplicate: 'Skipped: duplicate in file',
                          skip_enrolled: 'Skipped: already enrolled',
                        }[r.action]
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function Sections({ course }: { course: CourseDTO }) {
  const { api } = useOrg();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const sections = useQuery({
    queryKey: ['org', api, 'courses', course.id, 'sections'],
    queryFn: () => get<SectionDTO[]>(`${api}/courses/${course.id}/sections`),
  });
  const create = useMutation({
    mutationFn: () => post(`${api}/courses/${course.id}/sections`, { name }),
    onSuccess: async () => {
      setName('');
      await qc.invalidateQueries({ queryKey: ['org', api, 'courses', course.id, 'sections'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not create the section.'),
  });
  const toggle = useMutation({
    mutationFn: (s: SectionDTO) =>
      patch(`${api}/courses/${course.id}/sections/${s.id}`, {
        status: s.status === 'active' ? 'archived' : 'active',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org', api, 'courses', course.id, 'sections'] }),
  });
  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-fg-muted">
        Sections let you target assignments at part of the class. Assign students to sections from the roster.
      </p>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <Field label="New section name" className="flex-1">
          {({ id }) => (
            <Input
              id={id}
              value={name}
              maxLength={LIMITS.sectionName}
              onChange={(e) => setName(e.target.value)}
              disabled={course.status === 'archived'}
            />
          )}
        </Field>
        <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
          Add section
        </Button>
      </form>
      {sections.isPending && <SkeletonRows rows={2} />}
      {sections.data?.length === 0 && (
        <p className="text-sm text-fg-muted">No sections. Assignments go to the whole course.</p>
      )}
      <ul className="divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
        {sections.data?.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span>
              <span className="font-medium">{s.name}</span>{' '}
              <span className="tabular text-sm text-fg-muted">{s.studentCount} students</span>
              {s.status === 'archived' && <Badge className="ml-2">Archived</Badge>}
            </span>
            <Button variant="ghost" size="sm" onClick={() => toggle.mutate(s)}>
              {s.status === 'active' ? 'Archive' : 'Restore'}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CourseReport({ course }: { course: CourseDTO }) {
  const { api, path } = useOrg();
  const report = useQuery({
    queryKey: ['org', api, 'courses', course.id, 'report'],
    queryFn: () => get<CourseReportDTO>(`${api}/courses/${course.id}/report`),
  });
  if (report.isPending) return <SkeletonRows />;
  if (report.error) return <ErrorState error={report.error} onRetry={() => void report.refetch()} />;
  const r = report.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">
          Based on published and closed assignments and released grades. {r.studentCount} active students.
        </p>
        <a
          className="inline-flex h-9.5 items-center gap-2 rounded-[var(--radius-control)] border border-border-strong px-4 text-sm font-medium hover:bg-surface-2"
          href={downloadUrl(`${api}/courses/${course.id}/gradebook.csv`)}
        >
          <Download className="h-4 w-4" aria-hidden /> Gradebook CSV
        </a>
      </div>
      <Card>
        <CardHeader title="By assignment" />
        <Table caption="Assignment completion">
          <thead>
            <tr>
              <Th>Assignment</Th>
              <Th>Due</Th>
              <Th>Submitted</Th>
              <Th>Late</Th>
              <Th>Graded</Th>
              <Th>Average</Th>
            </tr>
          </thead>
          <tbody>
            {r.assignments.map((a) => (
              <tr key={a.id}>
                <Td>
                  <Link
                    to={path(
                      course.myRole === 'instructor'
                        ? `/assignments/${a.id}/submissions`
                        : `/assignments/${a.id}`,
                    )}
                    className="font-medium hover:underline"
                  >
                    {a.title}
                  </Link>
                </Td>
                <Td className="whitespace-nowrap">{formatDate(a.dueAt)}</Td>
                <Td className="tabular">
                  {a.submitted}/{a.targeted}
                  {a.completionRate != null && <span className="text-fg-muted"> ({a.completionRate}%)</span>}
                </Td>
                <Td className="tabular">{a.late}</Td>
                <Td className="tabular">{a.graded}</Td>
                <Td className="tabular">{a.averagePercent != null ? `${a.averagePercent}%` : 'n/a'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Card>
        <CardHeader title="By student" />
        <Table caption="Student progress">
          <thead>
            <tr>
              <Th>Student</Th>
              <Th>Submitted</Th>
              <Th>Late</Th>
              <Th>Missing</Th>
              <Th>Average</Th>
            </tr>
          </thead>
          <tbody>
            {r.students.map((s) => (
              <tr key={s.studentId}>
                <Td className="font-medium">{s.name}</Td>
                <Td className="tabular">{s.submitted}</Td>
                <Td className="tabular">{s.late}</Td>
                <Td className={s.missing > 0 ? 'tabular font-semibold text-danger' : 'tabular'}>
                  {s.missing}
                </Td>
                <Td className="tabular">{s.averagePercent != null ? `${s.averagePercent}%` : 'n/a'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function CourseSettings({ course }: { course: CourseDTO }) {
  const { api } = useOrg();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const toggle = useMutation({
    mutationFn: () =>
      post<CourseDTO>(`${api}/courses/${course.id}/${course.status === 'active' ? 'archive' : 'restore'}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['org', api, 'courses'] });
      setConfirm(false);
      toast.success(course.status === 'active' ? 'Course archived.' : 'Course restored.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Action failed.'),
  });
  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <CardHeader
          title="Course details"
          actions={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setEditing(true)}
              disabled={course.status === 'archived'}
            >
              Edit
            </Button>
          }
        />
        <CardBody>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-fg-muted">Code</dt>
              <dd className="font-mono">{course.code}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">Term</dt>
              <dd>{course.term}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">Department</dt>
              <dd>{course.departmentName ?? 'None'}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">Created</dt>
              <dd>{formatDate(course.createdAt)}</dd>
            </div>
          </dl>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={course.status === 'active' ? 'Archive course' : 'Restore course'} />
        <CardBody className="space-y-3">
          <p className="text-sm text-fg-muted">
            {course.status === 'active'
              ? 'Archiving makes the course read-only. Students keep access to their grades and feedback; nothing is deleted.'
              : 'Restoring makes the course editable again.'}
          </p>
          <Button
            variant={course.status === 'active' ? 'danger' : 'primary'}
            onClick={() => setConfirm(true)}
          >
            {course.status === 'active' ? 'Archive course' : 'Restore course'}
          </Button>
        </CardBody>
      </Card>
      <CourseFormDialog open={editing} onOpenChange={setEditing} course={course} />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={course.status === 'active' ? `Archive ${course.code}?` : `Restore ${course.code}?`}
        confirmLabel={course.status === 'active' ? 'Archive' : 'Restore'}
        tone={course.status === 'active' ? 'danger' : 'primary'}
        pending={toggle.isPending}
        onConfirm={() => toggle.mutate()}
      />
    </div>
  );
}
