import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Inbox as InboxIcon, Send } from '../../components/ui/icons';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import type { AssignmentDTO, InboxRowDTO, Paginated, SectionDTO } from '@sat/shared';
import { useOrg } from '../../app/org';
import { Button, ButtonLink } from '../../components/ui/button';
import {
  Alert,
  Badge,
  EmptyState,
  ErrorState,
  SkeletonRows,
  SubmissionStatusBadge,
} from '../../components/ui/feedback';
import { Field, Input, Select, Textarea } from '../../components/ui/form';
import { PageHeader, Pagination, Table, Td, Th } from '../../components/ui/layout';
import { ConfirmDialog, Dialog } from '../../components/ui/overlay';
import { ApiError, get, post } from '../../lib/api';
import { formatDateTime, formatPoints, formatShort, fromLocalInput } from '../../lib/format';
import { useDebounced } from '../../lib/useDebounced';

const FILTERS = [
  ['all', 'Everyone'],
  ['needs_grading', 'Needs grading'],
  ['submitted', 'Submitted'],
  ['late', 'Late'],
  ['graded', 'Grade published'],
  ['returned', 'Returned'],
  ['not_submitted', 'Not submitted'],
  ['missing', 'Missing'],
] as const;

export function InboxPage() {
  const { assignmentId = '' } = useParams();
  const { api, path } = useOrg();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'all';
  const sectionId = params.get('sectionId') ?? '';
  const page = Number(params.get('page') ?? 1);
  const sort = params.get('sort') ?? 'name';
  const [q, setQ] = useState('');
  const search = useDebounced(q, 300);
  const [publishAllOpen, setPublishAllOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [grantFor, setGrantFor] = useState<InboxRowDTO | null>(null);
  const [grantDate, setGrantDate] = useState('');
  const [grantNote, setGrantNote] = useState('');

  const assignment = useQuery({
    queryKey: ['org', api, 'assignments', assignmentId],
    queryFn: () => get<AssignmentDTO>(`${api}/assignments/${assignmentId}`),
  });
  const sections = useQuery({
    queryKey: ['org', api, 'courses', assignment.data?.courseId, 'sections'],
    queryFn: () => get<SectionDTO[]>(`${api}/courses/${assignment.data?.courseId}/sections`),
    enabled: Boolean(assignment.data),
  });
  const inbox = useQuery({
    queryKey: ['org', api, 'assignments', assignmentId, 'inbox', { status, sectionId, page, sort, search }],
    queryFn: () =>
      get<Paginated<InboxRowDTO>>(`${api}/assignments/${assignmentId}/submissions`, {
        status,
        sectionId: sectionId || undefined,
        page,
        sort,
        q: search,
        pageSize: 50,
      }),
    placeholderData: keepPreviousData,
    enabled: Boolean(assignment.data?.canGrade),
  });
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value && value !== 'all') next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ['org', api] });
  const publishAll = useMutation({
    mutationFn: () =>
      post<{ published: number; skipped: string[] }>(
        `${api}/assignments/${assignmentId}/grades/publish-all`,
        {},
      ),
    onSuccess: async (r) => {
      setPublishAllOpen(false);
      await refresh();
      toast.success(
        `${r.published} grade(s) published${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}.`,
      );
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not publish grades.'),
  });
  const release = useMutation({
    mutationFn: () => post(`${api}/assignments/${assignmentId}/grades/release`),
    onSuccess: async () => {
      setReleaseOpen(false);
      await refresh();
      toast.success('Grades released to students.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not release grades.'),
  });
  const grant = useMutation({
    mutationFn: () =>
      post(`${api}/assignments/${assignmentId}/extensions`, {
        studentId: grantFor?.studentId,
        dueAt: fromLocalInput(grantDate),
        note: grantNote,
      }),
    onSuccess: async () => {
      setGrantFor(null);
      setGrantDate('');
      setGrantNote('');
      await refresh();
      toast.success('Extension granted and the student notified.');
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError
          ? (Object.values(e.fields)[0]?.[0] ?? e.message)
          : 'Could not grant the extension.',
      ),
  });

  if (assignment.isPending) return <SkeletonRows rows={8} />;
  if (assignment.error) return <ErrorState error={assignment.error} />;
  const a = assignment.data;
  if (!a.canGrade) {
    return (
      <EmptyState
        icon={InboxIcon}
        title="Submissions are visible to the course's instructors"
        description="Administrators manage assignments but do not see student work. Use audited record access from the organization tools if you need a specific record."
        action={<ButtonLink to={path(`/assignments/${a.id}`)}>Back to the assignment</ButtonLink>}
      />
    );
  }
  const draftCount = inbox.data?.items.filter((r) => r.gradeStatus === 'draft').length ?? 0;
  const held = a.gradeRelease === 'hold' && !a.gradesReleasedAt;

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Assignments', to: path('/assignments') },
          { label: a.title, to: path(`/assignments/${a.id}`) },
          { label: 'Submissions' },
        ]}
        title={`Submissions: ${a.title}`}
        description={`${a.courseCode} · due ${formatDateTime(a.dueAt)} · ${a.maxPoints} points`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setPublishAllOpen(true)}>
              <Send className="h-4 w-4" aria-hidden /> Publish all drafts
            </Button>
            {held && <Button onClick={() => setReleaseOpen(true)}>Release grades to students</Button>}
          </>
        }
      />
      {held && (
        <Alert tone="info" className="mb-4">
          Grades for this assignment are held. Students see nothing until you release them.
        </Alert>
      )}
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter submissions">
        {FILTERS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={status === value}
            onClick={() => set('status', value)}
            className="rounded-full border border-border px-3 py-1 text-sm font-medium text-fg-muted hover:bg-surface-2 aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent-soft-fg"
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label="Search students">
          {({ id }) => (
            <Input
              id={id}
              type="search"
              placeholder="Name, email or student number"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          )}
        </Field>
        {(sections.data?.length ?? 0) > 0 && (
          <Field label="Section">
            {({ id }) => (
              <Select id={id} value={sectionId} onChange={(e) => set('sectionId', e.target.value)}>
                <option value="">All sections</option>
                {sections.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Sort by">
          {({ id }) => (
            <Select id={id} value={sort} onChange={(e) => set('sort', e.target.value)}>
              <option value="name">Name</option>
              <option value="-submittedAt">Most recently submitted</option>
              <option value="submittedAt">Earliest submitted</option>
              <option value="status">Status</option>
            </Select>
          )}
        </Field>
      </div>
      {inbox.isPending && <SkeletonRows rows={8} />}
      {inbox.error && <ErrorState error={inbox.error} onRetry={() => void inbox.refetch()} />}
      {inbox.data && inbox.data.items.length === 0 && (
        <EmptyState icon={InboxIcon} title="Nobody matches this filter" />
      )}
      {inbox.data && inbox.data.items.length > 0 && (
        <>
          <Table caption="Submissions">
            <thead>
              <tr>
                <Th>Student</Th>
                <Th>Status</Th>
                <Th>Submitted</Th>
                <Th>Attempts</Th>
                <Th>Grade</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {inbox.data.items.map((r) => (
                <tr key={r.studentId} className="hover:bg-surface-2">
                  <Td>
                    <span className="font-medium">{r.name}</span>
                    <span className="block text-xs text-fg-muted">
                      {r.studentNumber ?? r.email}
                      {r.sectionName ? ` · ${r.sectionName}` : ''}
                    </span>
                    {r.extensionDueAt && (
                      <Badge tone="info" className="mt-1">
                        Extended to {formatShort(r.extensionDueAt)}
                      </Badge>
                    )}
                  </Td>
                  <Td>
                    <SubmissionStatusBadge status={r.displayStatus} />
                  </Td>
                  <Td className="whitespace-nowrap">
                    {r.submittedAt ? (
                      formatShort(r.submittedAt)
                    ) : (
                      <span className="text-fg-muted">Not yet</span>
                    )}
                  </Td>
                  <Td className="tabular">{r.attemptCount || ''}</Td>
                  <Td className="tabular whitespace-nowrap">
                    {r.finalPoints != null ? formatPoints(r.finalPoints, a.maxPoints) : ''}
                    {r.gradeStatus === 'draft' && (
                      <Badge tone="info" className="ml-2">
                        Unpublished
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    {r.submissionId ? (
                      <Link
                        to={path(`/grading/${r.submissionId}`)}
                        className="text-sm font-medium text-accent hover:underline"
                      >
                        {r.gradeStatus === 'none' ? 'Grade' : 'Review'}
                      </Link>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => setGrantFor(r)}>
                        <CalendarPlus className="h-4 w-4" aria-hidden /> Extend
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            page={inbox.data.page}
            totalPages={inbox.data.totalPages}
            total={inbox.data.total}
            onPage={(p) => set('page', String(p))}
          />
        </>
      )}
      <ConfirmDialog
        open={publishAllOpen}
        onOpenChange={setPublishAllOpen}
        title="Publish all unpublished grades?"
        description={`First-time grading drafts for this assignment are published${held ? ' (students still will not see them until you release grades)' : ' and students are notified'}. Corrections to already-published grades must be published one at a time with a reason.${draftCount ? ` ${draftCount} draft(s) are on this page.` : ''}`}
        confirmLabel="Publish drafts"
        pending={publishAll.isPending}
        onConfirm={() => publishAll.mutate()}
      />
      <ConfirmDialog
        open={releaseOpen}
        onOpenChange={setReleaseOpen}
        title="Release grades to students?"
        description="Every published grade for this assignment becomes visible to its student, and they are notified. This cannot be undone."
        confirmLabel="Release grades"
        pending={release.isPending}
        onConfirm={() => release.mutate()}
      />
      <Dialog
        open={grantFor != null}
        onOpenChange={(o) => !o && setGrantFor(null)}
        title={`Grant an extension to ${grantFor?.name ?? ''}`}
        description={`The original due date is ${formatDateTime(a.dueAt)}.`}
        footer={
          <Button loading={grant.isPending} disabled={!grantDate} onClick={() => grant.mutate()}>
            Grant extension
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="New due date" required hint="In your time zone.">
            {({ id, describedBy }) => (
              <Input
                id={id}
                type="datetime-local"
                aria-describedby={describedBy}
                value={grantDate}
                onChange={(e) => setGrantDate(e.target.value)}
              />
            )}
          </Field>
          <Field label="Note to the student (optional)">
            {({ id }) => (
              <Textarea
                id={id}
                value={grantNote}
                maxLength={2000}
                onChange={(e) => setGrantNote(e.target.value)}
              />
            )}
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
