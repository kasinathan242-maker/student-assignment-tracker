import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CheckCircle2, ClipboardList, Plus, Printer } from '../../components/ui/icons';
import { useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import {
  ASSIGNMENT_TYPES,
  type AssignmentDTO,
  type CourseDTO,
  type Paginated,
  type SubmissionReceiptDTO,
  type SubmissionVersionDTO,
} from '@sat/shared';
import { useOrg } from '../../app/org';
import { ButtonLink } from '../../components/ui/button';
import {
  AssignmentStatusBadge,
  EmptyState,
  ErrorState,
  SkeletonRows,
  SubmissionStatusBadge,
} from '../../components/ui/feedback';
import { Field, Input, Select } from '../../components/ui/form';
import { PageHeader, Pagination, Table, Td, Th } from '../../components/ui/layout';
import { get } from '../../lib/api';
import { formatDateTime, formatRelative, formatShort, TYPE_LABEL } from '../../lib/format';
import { useDebounced } from '../../lib/useDebounced';
import { StudentAssignmentView } from './StudentAssignmentView';
import { TeacherAssignmentView } from './TeacherAssignmentView';

const BUCKETS = [
  { value: '', label: 'All' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'pending', label: 'To do' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'overdue', label: 'Overdue or missing' },
  { value: 'returned', label: 'Needs revision' },
  { value: 'graded', label: 'Graded' },
] as const;

export function AssignmentListPage() {
  const { api, path, role } = useOrg();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const search = useDebounced(q, 300);
  const page = Number(params.get('page') ?? 1);
  const bucket = params.get('bucket') ?? '';
  const status = params.get('status') ?? '';
  const courseId = params.get('courseId') ?? '';
  const type = params.get('type') ?? '';
  const sort = params.get('sort') ?? 'dueAt';
  const student = role === 'student';
  const courses = useQuery({
    queryKey: ['org', api, 'courses', { scope: 'mine', all: true }],
    queryFn: () => get<Paginated<CourseDTO>>(`${api}/courses`, { pageSize: 100 }),
  });
  const list = useQuery({
    queryKey: ['org', api, 'assignments', { search, page, bucket, status, courseId, type, sort }],
    queryFn: () =>
      get<Paginated<AssignmentDTO>>(`${api}/assignments`, {
        q: search,
        page,
        pageSize: 25,
        bucket: student ? bucket || undefined : undefined,
        status: student ? undefined : status || undefined,
        courseId: courseId || undefined,
        type: type || undefined,
        sort,
      }),
    placeholderData: keepPreviousData,
  });
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  const teaching = (courses.data?.items ?? []).filter((c) => c.myRole === 'instructor');

  return (
    <div>
      <PageHeader
        title="Assignments"
        description={
          student
            ? 'Everything assigned to you across your courses.'
            : 'Assignments in the courses you manage.'
        }
        actions={
          !student &&
          teaching.length > 0 && (
            <ButtonLink to={path('/assignments/new')} variant="primary">
              <Plus className="h-4 w-4" aria-hidden /> New assignment
            </ButtonLink>
          )
        }
      />
      {student && (
        <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {BUCKETS.map((b) => (
            <button
              key={b.value}
              type="button"
              aria-pressed={bucket === b.value}
              onClick={() => set('bucket', b.value)}
              className="rounded-full border border-border px-3 py-1 text-sm font-medium text-fg-muted hover:bg-surface-2 aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent-soft-fg"
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Search" className="lg:col-span-2">
          {({ id }) => (
            <Input
              id={id}
              type="search"
              placeholder="Assignment title"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          )}
        </Field>
        <Field label="Course">
          {({ id }) => (
            <Select id={id} value={courseId} onChange={(e) => set('courseId', e.target.value)}>
              <option value="">All courses</option>
              {courses.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {!student ? (
          <Field label="Status">
            {({ id }) => (
              <Select id={id} value={status} onChange={(e) => set('status', e.target.value)}>
                <option value="">Not archived</option>
                <option value="draft">Draft</option>
                <option value="scheduled">Scheduled</option>
                <option value="published">Published</option>
                <option value="closed">Closed</option>
                <option value="archived">Archived</option>
              </Select>
            )}
          </Field>
        ) : (
          <Field label="Type">
            {({ id }) => (
              <Select id={id} value={type} onChange={(e) => set('type', e.target.value)}>
                <option value="">All types</option>
                {ASSIGNMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Sort by">
          {({ id }) => (
            <Select id={id} value={sort} onChange={(e) => set('sort', e.target.value)}>
              <option value="dueAt">Due date (soonest)</option>
              <option value="-dueAt">Due date (latest)</option>
              <option value="title">Title</option>
              <option value="-createdAt">Newest</option>
            </Select>
          )}
        </Field>
      </div>
      {list.isPending && <SkeletonRows rows={8} />}
      {list.error && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && list.data.items.length === 0 && (
        <EmptyState
          icon={ClipboardList}
          title="No assignments match"
          description={
            search || bucket || status || courseId
              ? 'Try clearing the filters.'
              : student
                ? 'Published assignments from your courses will appear here.'
                : 'Create an assignment from one of your courses.'
          }
        />
      )}
      {list.data && list.data.items.length > 0 && (
        <>
          <Table caption="Assignments">
            <thead>
              <tr>
                <Th>Assignment</Th>
                <Th>Course</Th>
                <Th>Due</Th>
                <Th>{student ? 'Your status' : 'Status'}</Th>
                <Th className="text-right">{student ? 'Score' : 'Points'}</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((a) => {
                const due = a.my?.effectiveDueAt ?? a.dueAt;
                return (
                  <tr key={a.id} className="hover:bg-surface-2">
                    <Td>
                      <Link to={path(`/assignments/${a.id}`)} className="font-medium hover:underline">
                        {a.title}
                      </Link>
                      <span className="block text-xs text-fg-muted">{TYPE_LABEL[a.type]}</span>
                    </Td>
                    <Td className="font-mono text-sm">{a.courseCode}</Td>
                    <Td className="whitespace-nowrap">
                      <span className="tabular">{formatShort(due)}</span>
                      <span className="block text-xs text-fg-muted">
                        {formatRelative(due)}
                        {a.my?.extensionDueAt ? ' · extended' : ''}
                      </span>
                    </Td>
                    <Td>
                      {a.my ? (
                        <SubmissionStatusBadge status={a.my.displayStatus} />
                      ) : (
                        <AssignmentStatusBadge status={a.status} />
                      )}
                    </Td>
                    <Td className="tabular text-right">
                      {a.my
                        ? a.my.finalPoints != null
                          ? `${a.my.finalPoints} / ${a.maxPoints}`
                          : `/ ${a.maxPoints}`
                        : a.maxPoints}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <Pagination
            page={list.data.page}
            totalPages={list.data.totalPages}
            total={list.data.total}
            onPage={(p) => set('page', String(p))}
          />
        </>
      )}
    </div>
  );
}

export function AssignmentDetailPage() {
  const { assignmentId = '' } = useParams();
  const { api } = useOrg();
  const q = useQuery({
    queryKey: ['org', api, 'assignments', assignmentId],
    queryFn: () => get<AssignmentDTO>(`${api}/assignments/${assignmentId}`),
  });
  if (q.isPending) return <SkeletonRows rows={8} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return q.data.canManage ? (
    <TeacherAssignmentView assignment={q.data} />
  ) : (
    <StudentAssignmentView assignment={q.data} />
  );
}

/** Submission confirmation with a printable receipt. */
export function ReceiptPage() {
  const { assignmentId = '' } = useParams();
  const { api, path } = useOrg();
  const location = useLocation();
  const fromSubmit = (location.state as { receipt?: SubmissionReceiptDTO } | null)?.receipt;
  const versions = useQuery({
    queryKey: ['org', api, 'assignments', assignmentId, 'versions'],
    queryFn: () => get<SubmissionVersionDTO[]>(`${api}/assignments/${assignmentId}/my-submission/versions`),
  });
  const assignment = useQuery({
    queryKey: ['org', api, 'assignments', assignmentId],
    queryFn: () => get<AssignmentDTO>(`${api}/assignments/${assignmentId}`),
  });
  const latest = versions.data?.[0];
  if (versions.isPending || assignment.isPending) return <SkeletonRows />;
  if (versions.error) return <ErrorState error={versions.error} />;
  if (!latest)
    return (
      <EmptyState
        title="No submission yet"
        action={<ButtonLink to={path(`/assignments/${assignmentId}`)}>Back to the assignment</ButtonLink>}
      />
    );
  return (
    <div className="max-w-2xl">
      {fromSubmit && (
        <div
          role="status"
          className="mb-6 flex items-start gap-3 rounded-[var(--radius-card)] border border-success/30 bg-success-soft px-4 py-3"
        >
          <CheckCircle2 className="mt-0.5 h-5 w-5 text-success" aria-hidden />
          <div>
            <p className="font-semibold">Your work was submitted.</p>
            <p className="text-sm">
              The server recorded it at {formatDateTime(latest.submittedAt)}. Keep the receipt code for your
              records.
            </p>
          </div>
        </div>
      )}
      <PageHeader
        title="Submission receipt"
        breadcrumbs={[
          { label: 'Assignments', to: path('/assignments') },
          { label: assignment.data?.title ?? 'Assignment', to: path(`/assignments/${assignmentId}`) },
          { label: 'Receipt' },
        ]}
        actions={
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex h-9.5 items-center gap-2 rounded-[var(--radius-control)] border border-border-strong px-4 text-sm font-medium hover:bg-surface-2"
          >
            <Printer className="h-4 w-4" aria-hidden /> Print
          </button>
        }
      />
      <dl className="grid gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-5 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-fg-muted">Receipt code</dt>
          <dd className="font-mono text-lg font-semibold">{latest.receiptCode}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Attempt</dt>
          <dd className="tabular text-lg font-semibold">{latest.attemptNumber}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Assignment</dt>
          <dd>
            {assignment.data?.courseCode} · {assignment.data?.title}
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Submitted (server time)</dt>
          <dd>{formatDateTime(latest.submittedAt)}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Due</dt>
          <dd>{formatDateTime(latest.effectiveDueAt)}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Timing</dt>
          <dd>{latest.isLate ? `Late by ${Math.ceil(latest.lateByMinutes / 60)} hour(s)` : 'On time'}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-fg-muted">Contents</dt>
          <dd>
            {[
              latest.text ? 'Written response' : null,
              latest.url ? 'Link' : null,
              latest.files.length
                ? `${latest.files.length} file(s): ${latest.files.map((f) => f.name).join(', ')}`
                : null,
            ]
              .filter(Boolean)
              .join('; ')}
          </dd>
        </div>
      </dl>
      <div className="mt-6">
        <ButtonLink to={path(`/assignments/${assignmentId}`)}>Back to the assignment</ButtonLink>
      </div>
    </div>
  );
}
