import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  CalendarClock,
  Copy,
  Eye,
  Inbox,
  Lock,
  Pencil,
  Send,
  Trash2,
  Undo2,
  Unlock,
  Upload,
} from '../../components/ui/icons';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type {
  AssignmentChangeDTO,
  AssignmentDTO,
  AssignmentStatsDTO,
  Paginated,
  RubricDTO,
} from '@sat/shared';
import { useOrg } from '../../app/org';
import { Button, ButtonLink } from '../../components/ui/button';
import { Alert, AssignmentStatusBadge, Badge, ErrorState, SkeletonRows } from '../../components/ui/feedback';
import { Field, Input } from '../../components/ui/form';
import {
  Card,
  CardBody,
  CardHeader,
  Markdown,
  PageHeader,
  Pagination,
  Stat,
  StatGrid,
} from '../../components/ui/layout';
import { ConfirmDialog, Dialog } from '../../components/ui/overlay';
import { ApiError, del, downloadUrl, get, post, upload } from '../../lib/api';
import { formatBytes, formatDateTime, formatRelative, fromLocalInput, TYPE_LABEL } from '../../lib/format';
import { AttachmentList, PolicySummary, RubricView } from './StudentAssignmentView';

type Action = 'publish' | 'close' | 'reopen' | 'archive' | 'restore' | 'unschedule';

const ACTION_COPY: Record<Action, { title: string; description: string; confirm: string; danger?: boolean }> =
  {
    publish: {
      title: 'Publish now?',
      description:
        'Students in the course (or the selected sections) will see it immediately and be notified.',
      confirm: 'Publish',
    },
    close: {
      title: 'Close submissions?',
      description:
        'Students can no longer submit, except those with an approved extension. You can reopen it later.',
      confirm: 'Close',
      danger: true,
    },
    reopen: {
      title: 'Reopen submissions?',
      description: 'Students can submit again according to the deadline and late policy.',
      confirm: 'Reopen',
    },
    archive: {
      title: 'Archive this assignment?',
      description:
        'It is hidden from students. Submissions, grades and history are kept, and you can restore it.',
      confirm: 'Archive',
      danger: true,
    },
    restore: {
      title: 'Restore this assignment?',
      description: 'It returns as closed if it was ever published, otherwise as a draft.',
      confirm: 'Restore',
    },
    unschedule: {
      title: 'Cancel scheduled publication?',
      description: 'The assignment goes back to draft and will not be published automatically.',
      confirm: 'Cancel schedule',
    },
  };

const FIELD_LABEL: Record<string, string> = {
  dueAt: 'Due date',
  availableFrom: 'Opens',
  availableUntil: 'Closes',
  gracePeriodMinutes: 'Grace period',
  latePolicy: 'Late policy',
  resubmission: 'Resubmission',
  submissionMethods: 'Submission methods',
  fileRules: 'File rules',
  maxPoints: 'Points',
  sectionIds: 'Sections',
  instructions: 'Instructions',
  extensionsAllowed: 'Extensions',
  status: 'Status',
  title: 'Title',
  description: 'Summary',
};

export function TeacherAssignmentView({ assignment: a }: { assignment: AssignmentDTO }) {
  const { api, path } = useOrg();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [pending, setPending] = useState<Action | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [publishAt, setPublishAt] = useState('');
  const [preview, setPreview] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const stats = useQuery({
    queryKey: ['org', api, 'assignments', a.id, 'stats'],
    queryFn: () => get<AssignmentStatsDTO>(`${api}/assignments/${a.id}/stats`),
    enabled: a.status !== 'draft',
  });
  const rubric = useQuery({
    queryKey: ['org', api, 'rubrics', a.rubricId],
    queryFn: () => get<RubricDTO>(`${api}/rubrics/${a.rubricId}`),
    enabled: Boolean(a.rubricId),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['org', api] });

  const transition = useMutation({
    mutationFn: (action: Action) =>
      post<AssignmentDTO>(`${api}/assignments/${a.id}/${action}`, { expectedRev: a.rev }),
    onSuccess: async (_d, action) => {
      setPending(null);
      await refresh();
      toast.success(
        {
          publish: 'Published.',
          close: 'Submissions closed.',
          reopen: 'Reopened.',
          archive: 'Archived.',
          restore: 'Restored.',
          unschedule: 'Schedule cancelled.',
        }[action],
      );
    },
    onError: async (e) => {
      setPending(null);
      toast.error(e instanceof ApiError ? e.message : 'Action failed.');
      if (e instanceof ApiError && e.code === 'stale_revision') await refresh();
    },
  });
  const schedule = useMutation({
    mutationFn: () =>
      post<AssignmentDTO>(`${api}/assignments/${a.id}/schedule`, {
        expectedRev: a.rev,
        publishAt: fromLocalInput(publishAt),
      }),
    onSuccess: async () => {
      setScheduleOpen(false);
      await refresh();
      toast.success('Publication scheduled.');
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError ? (Object.values(e.fields)[0]?.[0] ?? e.message) : 'Could not schedule.',
      ),
  });
  const duplicate = useMutation({
    mutationFn: () => post<AssignmentDTO>(`${api}/assignments/${a.id}/duplicate`, {}),
    onSuccess: async (copy) => {
      await refresh();
      toast.success('Copy created as a draft.');
      navigate(path(`/assignments/${copy.id}/edit`));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not duplicate.'),
  });
  const removeAttachment = useMutation({
    mutationFn: (fileId: string) => del(`${api}/assignments/${a.id}/attachments/${fileId}`),
    onSuccess: refresh,
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not remove the file.'),
  });

  const uploadAttachment = async (file: File) => {
    try {
      setUploadProgress(0);
      await upload(`${api}/assignments/${a.id}/attachments`, file, setUploadProgress);
      await refresh();
      toast.success(`${file.name} attached.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Upload failed.');
    } finally {
      setUploadProgress(null);
    }
  };

  const archived = a.status === 'archived';
  const s = stats.data;
  /** Stat tiles open the filtered inbox, but only for instructors (administrators cannot see submissions). */
  const inboxLink = (status: string) =>
    a.canGrade ? path(`/assignments/${a.id}/submissions?status=${status}`) : undefined;

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Assignments', to: path('/assignments') },
          { label: a.courseCode, to: path(`/courses/${a.courseId}`) },
          { label: a.title },
        ]}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {a.title} <AssignmentStatusBadge status={a.status} />
          </span>
        }
        description={`${TYPE_LABEL[a.type]} · ${a.courseCode} · due ${formatDateTime(a.dueAt, a.timezone)}`}
        actions={
          <>
            {a.canGrade && a.status !== 'draft' && a.status !== 'scheduled' && (
              <ButtonLink to={path(`/assignments/${a.id}/submissions`)} variant="primary">
                <Inbox className="h-4 w-4" aria-hidden /> Submissions
              </ButtonLink>
            )}
            {!archived && (
              <ButtonLink to={path(`/assignments/${a.id}/edit`)}>
                <Pencil className="h-4 w-4" aria-hidden /> Edit
              </ButtonLink>
            )}
            {(a.status === 'draft' || a.status === 'scheduled') && (
              <Button onClick={() => setPending('publish')}>
                <Send className="h-4 w-4" aria-hidden /> Publish now
              </Button>
            )}
            {a.status === 'draft' && (
              <Button variant="secondary" onClick={() => setScheduleOpen(true)}>
                <CalendarClock className="h-4 w-4" aria-hidden /> Schedule
              </Button>
            )}
            {a.status === 'scheduled' && (
              <Button variant="secondary" onClick={() => setPending('unschedule')}>
                Cancel schedule
              </Button>
            )}
            {a.status === 'published' && (
              <Button variant="secondary" onClick={() => setPending('close')}>
                <Lock className="h-4 w-4" aria-hidden /> Close
              </Button>
            )}
            {a.status === 'closed' && (
              <Button variant="secondary" onClick={() => setPending('reopen')}>
                <Unlock className="h-4 w-4" aria-hidden /> Reopen
              </Button>
            )}
            <Button variant="secondary" loading={duplicate.isPending} onClick={() => duplicate.mutate()}>
              <Copy className="h-4 w-4" aria-hidden /> Duplicate
            </Button>
            {archived ? (
              <Button variant="secondary" onClick={() => setPending('restore')}>
                <Undo2 className="h-4 w-4" aria-hidden /> Restore
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setPending('archive')}>
                <Archive className="h-4 w-4" aria-hidden /> Archive
              </Button>
            )}
          </>
        }
      />

      {a.status === 'scheduled' && a.publishAt && (
        <Alert tone="info" className="mb-4">
          Scheduled to publish {formatDateTime(a.publishAt)} ({formatRelative(a.publishAt)}).
        </Alert>
      )}
      {a.gradeRelease === 'hold' && !a.gradesReleasedAt && a.status !== 'draft' && (
        <Alert tone="info" className="mb-4">
          {a.canGrade
            ? 'Grades are held: students will not see them until you release grades from the submissions page.'
            : 'Grades are held: students will not see them until an instructor releases them.'}
        </Alert>
      )}

      {s && (
        <div className="mb-6">
          <StatGrid>
            <Stat label="Submitted" value={`${s.submitted}/${s.targeted}`} to={inboxLink('submitted')} />
            <Stat label="Late" value={s.late} to={inboxLink('late')} />
            <Stat
              label="Not submitted"
              value={s.notSubmitted}
              hint={s.missing ? `${s.missing} missing` : undefined}
              to={inboxLink('not_submitted')}
            />
            <Stat
              label="To grade"
              value={Math.max(0, s.submitted - s.gradedPublished - s.returned)}
              to={inboxLink('needs_grading')}
            />
            <Stat
              label="Grades published"
              value={s.gradedPublished}
              hint={s.gradedDraft ? `${s.gradedDraft} unpublished` : undefined}
            />
            <Stat label="Average" value={s.averagePercent != null ? `${s.averagePercent}%` : 'n/a'} />
          </StatGrid>
        </div>
      )}

      <div className="mb-4 flex justify-end">
        <Button variant="ghost" size="sm" aria-pressed={preview} onClick={() => setPreview((v) => !v)}>
          <Eye className="h-4 w-4" aria-hidden /> {preview ? 'Back to instructor view' : 'Preview as student'}
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-6">
          <Card className={preview ? 'ring-2 ring-accent/40' : undefined}>
            <CardHeader title={preview ? 'Student view: instructions' : 'Instructions'} />
            <CardBody className="space-y-4">
              {a.description && <p className="text-fg-muted">{a.description}</p>}
              {a.instructions ? (
                <Markdown>{a.instructions}</Markdown>
              ) : (
                <p className="text-sm text-fg-muted">No written instructions.</p>
              )}
              {a.learningObjectives.length > 0 && (
                <div>
                  <h3 className="mb-1 text-sm font-semibold">Learning objectives</h3>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {a.learningObjectives.map((o) => (
                      <li key={o}>{o}</li>
                    ))}
                  </ul>
                </div>
              )}
              {preview && <AttachmentList files={a.attachments} />}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Requirements and policies" />
            <CardBody>
              <PolicySummary a={a} />
              {!preview && (
                <dl className="mt-3 grid gap-3 border-t border-border pt-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-fg-muted">Recipients</dt>
                    <dd>{a.sectionIds.length ? `${a.sectionIds.length} section(s)` : 'Whole course'}</dd>
                  </div>
                  <div>
                    <dt className="text-fg-muted">Grade release</dt>
                    <dd>
                      {a.gradeRelease === 'hold'
                        ? a.gradesReleasedAt
                          ? `Released ${formatDateTime(a.gradesReleasedAt)}`
                          : 'Held until released'
                        : 'When each grade is published'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-fg-muted">Extension requests</dt>
                    <dd>{a.extensionsAllowed ? 'Allowed' : 'Not allowed'}</dd>
                  </div>
                  <div>
                    <dt className="text-fg-muted">Time zone</dt>
                    <dd>{a.timezone}</dd>
                  </div>
                </dl>
              )}
            </CardBody>
          </Card>
          {rubric.data && (
            <Card>
              <CardHeader title={`Rubric: ${rubric.data.title}`} />
              <CardBody>
                <RubricView rubric={rubric.data.criteria} />
              </CardBody>
            </Card>
          )}
        </div>
        {!preview && (
          <div className="space-y-6">
            <Card>
              <CardHeader title="Reference files" />
              <CardBody className="space-y-3">
                <ul className="space-y-1.5">
                  {a.attachments.map((f) => (
                    <li key={f.id} className="flex items-center justify-between gap-2 text-sm">
                      <a href={downloadUrl(f.downloadPath)} className="truncate text-accent hover:underline">
                        {f.name}
                      </a>
                      <span className="flex shrink-0 items-center gap-1 text-fg-muted">
                        {formatBytes(f.size)}
                        {!archived && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove ${f.name}`}
                            onClick={() => removeAttachment.mutate(f.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                {a.attachments.length === 0 && <p className="text-sm text-fg-muted">No files attached.</p>}
                {!archived && (
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-control)] border border-dashed border-border-strong px-3 py-3 text-sm text-fg-muted hover:bg-surface-2 focus-within:outline-2 focus-within:outline-ring">
                    <Upload className="h-4 w-4" aria-hidden />
                    {uploadProgress != null
                      ? `Uploading ${Math.round(uploadProgress * 100)}%`
                      : 'Attach a file (max 50 MB)'}
                    <input
                      type="file"
                      className="sr-only"
                      disabled={uploadProgress != null}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) void uploadAttachment(file);
                      }}
                    />
                  </label>
                )}
              </CardBody>
            </Card>
            <ChangeHistory assignmentId={a.id} />
          </div>
        )}
      </div>

      {pending && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setPending(null)}
          title={ACTION_COPY[pending].title}
          description={ACTION_COPY[pending].description}
          confirmLabel={ACTION_COPY[pending].confirm}
          tone={ACTION_COPY[pending].danger ? 'danger' : 'primary'}
          pending={transition.isPending}
          onConfirm={() => transition.mutate(pending)}
        />
      )}
      <Dialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        title="Schedule publication"
        description={`The assignment will be published automatically and students notified. Times are in your time zone; the due date is ${formatDateTime(a.dueAt)}.`}
        footer={
          <Button loading={schedule.isPending} disabled={!publishAt} onClick={() => schedule.mutate()}>
            Schedule
          </Button>
        }
      >
        <Field label="Publish at" required>
          {({ id }) => (
            <Input
              id={id}
              type="datetime-local"
              value={publishAt}
              onChange={(e) => setPublishAt(e.target.value)}
            />
          )}
        </Field>
      </Dialog>
    </div>
  );
}

function ChangeHistory({ assignmentId }: { assignmentId: string }) {
  const { api } = useOrg();
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['org', api, 'assignments', assignmentId, 'changes', page],
    queryFn: () =>
      get<Paginated<AssignmentChangeDTO>>(`${api}/assignments/${assignmentId}/changes`, {
        page,
        pageSize: 8,
      }),
    placeholderData: keepPreviousData,
  });
  return (
    <Card>
      <CardHeader title="Change history" />
      <CardBody>
        {q.isPending && <SkeletonRows rows={3} />}
        {q.error && <ErrorState error={q.error} />}
        {q.data?.items.length === 0 && (
          <p className="text-sm text-fg-muted">
            No changes recorded yet. Edits, status changes and deadline moves will be listed here.
          </p>
        )}
        <ol className="space-y-3">
          {q.data?.items.map((c) => (
            <li key={c.id} className="text-sm">
              <p className="font-medium">
                {c.kind === 'created'
                  ? 'Created'
                  : c.kind === 'status'
                    ? `Status: ${String(c.before.status ?? '')} → ${String(c.after.status ?? '')}`
                    : `Changed ${c.changedFields.map((f) => FIELD_LABEL[f] ?? f).join(', ')}`}
                {c.changedFields.some((f) => ['dueAt', 'availableUntil', 'availableFrom'].includes(f)) && (
                  <Badge tone="warning" className="ml-2">
                    Deadline
                  </Badge>
                )}
              </p>
              <p className="text-fg-muted">
                {c.actor?.name ?? 'System'} · {formatDateTime(c.createdAt)}
              </p>
              {c.note && <p className="mt-0.5 text-fg-muted">“{c.note}”</p>}
            </li>
          ))}
        </ol>
        {q.data && (
          <Pagination
            page={q.data.page}
            totalPages={q.data.totalPages}
            total={q.data.total}
            onPage={setPage}
          />
        )}
      </CardBody>
    </Card>
  );
}
