import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Plus } from '../../components/ui/icons';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  LIMITS,
  type AnnouncementAudience,
  type AnnouncementDTO,
  type CourseDTO,
  type Paginated,
} from '@sat/shared';
import { useOrg } from '../../app/org';
import { Button } from '../../components/ui/button';
import { Alert, Badge, EmptyState, ErrorState, SkeletonRows } from '../../components/ui/feedback';
import { Checkbox, Field, FormError, Input, Select, Textarea } from '../../components/ui/form';
import { Card, CardBody, Markdown, PageHeader, Pagination } from '../../components/ui/layout';
import { ConfirmDialog, Dialog } from '../../components/ui/overlay';
import { ApiError, get, post } from '../../lib/api';
import { formatDateTime, formatRelative, fromLocalInput } from '../../lib/format';

const AUDIENCE_LABEL: Record<AnnouncementAudience, string> = {
  course: 'Course',
  org_all: 'Everyone',
  org_students: 'All students',
  org_teachers: 'All staff',
};

export function AnnouncementListPage() {
  const { api, path, role } = useOrg();
  const [params, setParams] = useSearchParams();
  const manage = params.get('view') === 'manage' && role !== 'student';
  const page = Number(params.get('page') ?? 1);
  const [composing, setComposing] = useState(false);
  const q = useQuery({
    queryKey: ['org', api, 'announcements', { manage, page }],
    queryFn: () =>
      get<Paginated<AnnouncementDTO>>(`${api}/announcements`, {
        manage: manage ? 'true' : undefined,
        page,
        pageSize: 20,
      }),
    placeholderData: keepPreviousData,
  });
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Announcements"
        actions={
          role !== 'student' && (
            <Button onClick={() => setComposing(true)}>
              <Plus className="h-4 w-4" aria-hidden /> New announcement
            </Button>
          )
        }
      />
      {role !== 'student' && (
        <div className="mb-4 flex gap-1.5" role="group" aria-label="View">
          {[
            ['', 'Visible to me'],
            ['manage', 'Manage (drafts, scheduled, archived)'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={(params.get('view') ?? '') === value}
              onClick={() => setParams(value ? { view: value } : {}, { replace: true })}
              className="rounded-full border border-border px-3 py-1 text-sm font-medium text-fg-muted hover:bg-surface-2 aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent-soft-fg"
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {q.isPending && <SkeletonRows />}
      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data?.items.length === 0 && <EmptyState icon={Megaphone} title="No announcements" />}
      <ul className="space-y-3">
        {q.data?.items.map((a) => (
          <li key={a.id}>
            <Link
              to={path(`/announcements/${a.id}`)}
              className="block rounded-[var(--radius-card)] border border-border bg-surface p-4 hover:border-border-strong hover:bg-surface-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h2 className={a.readAt || a.canManage ? 'font-semibold' : 'font-bold'}>{a.title}</h2>
                {!a.readAt && !a.canManage && <Badge tone="accent">New</Badge>}
                {a.requireAck && !a.acknowledgedAt && !a.canManage && (
                  <Badge tone="warning">Acknowledgement needed</Badge>
                )}
                {a.status !== 'published' && <Badge>{a.status}</Badge>}
              </div>
              <p className="mt-1 text-sm text-fg-muted">
                {a.courseCode ?? AUDIENCE_LABEL[a.audience]} · {a.author?.name ?? 'Staff'} ·{' '}
                {a.publishedAt
                  ? formatRelative(a.publishedAt)
                  : a.publishAt
                    ? `scheduled for ${formatDateTime(a.publishAt)}`
                    : 'draft'}
                {a.stats &&
                  ` · read by ${a.stats.read}${a.requireAck ? `, acknowledged by ${a.stats.acknowledged}` : ''}`}
              </p>
              <p className="mt-2 line-clamp-2 text-sm">{a.body.replace(/[#*_`>]/g, '')}</p>
            </Link>
          </li>
        ))}
      </ul>
      {q.data && (
        <Pagination
          page={q.data.page}
          totalPages={q.data.totalPages}
          total={q.data.total}
          onPage={(p) => setParams({ ...(manage ? { view: 'manage' } : {}), page: String(p) })}
        />
      )}
      <ComposeDialog open={composing} onOpenChange={setComposing} />
    </div>
  );
}

function ComposeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { api, role } = useOrg();
  const qc = useQueryClient();
  const courses = useQuery({
    queryKey: ['org', api, 'courses', { teaching: true }],
    queryFn: () => get<Paginated<CourseDTO>>(`${api}/courses`, { pageSize: 100 }),
    enabled: open,
  });
  const manageable = (courses.data?.items ?? []).filter(
    (c) => c.myRole === 'instructor' || role === 'org_admin',
  );
  const [audience, setAudience] = useState<AnnouncementAudience>('course');
  const [courseId, setCourseId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [publishAt, setPublishAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [sendEmail, setSendEmail] = useState(false);
  const [requireAck, setRequireAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  // Default to the first manageable course without storing derived state.
  const effectiveCourseId = courseId || manageable[0]?.id || '';
  const reset = () => {
    setTitle('');
    setBody('');
    setPublishAt('');
    setExpiresAt('');
    setSendEmail(false);
    setRequireAck(false);
    setError(null);
    setPreview(false);
  };
  const create = useMutation({
    mutationFn: (draft: boolean) =>
      post<AnnouncementDTO>(`${api}/announcements`, {
        title,
        body,
        audience,
        courseId: audience === 'course' ? effectiveCourseId : null,
        publishAt: fromLocalInput(publishAt),
        expiresAt: fromLocalInput(expiresAt),
        sendEmail,
        requireAck,
        draft,
      }),
    onSuccess: async (a) => {
      await qc.invalidateQueries({ queryKey: ['org', api, 'announcements'] });
      toast.success(
        a.status === 'published'
          ? 'Announcement published.'
          : a.status === 'scheduled'
            ? 'Announcement scheduled.'
            : 'Draft saved.',
      );
      reset();
      onOpenChange(false);
    },
    onError: (e) =>
      setError(e instanceof ApiError ? (Object.values(e.fields)[0]?.[0] ?? e.message) : 'Could not save.'),
  });
  return (
    <Dialog
      wide
      open={open}
      onOpenChange={onOpenChange}
      title="New announcement"
      footer={
        <>
          <Button variant="ghost" onClick={() => setPreview((v) => !v)}>
            {preview ? 'Edit' : 'Preview'}
          </Button>
          <Button
            variant="secondary"
            loading={create.isPending && create.variables}
            disabled={!title.trim() || !body.trim() || create.isPending}
            onClick={() => create.mutate(true)}
          >
            Save draft
          </Button>
          <Button
            loading={create.isPending && !create.variables}
            disabled={!title.trim() || !body.trim() || create.isPending}
            onClick={() => create.mutate(false)}
          >
            {publishAt ? 'Schedule' : 'Publish'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={error} />
        {preview ? (
          <div className="rounded-[var(--radius-control)] border border-border p-4">
            <h2 className="mb-2 text-lg font-semibold">{title || 'Untitled'}</h2>
            <Markdown>{body || '*Nothing written yet.*'}</Markdown>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Audience">
                {({ id }) => (
                  <Select
                    id={id}
                    value={audience}
                    onChange={(e) => setAudience(e.target.value as AnnouncementAudience)}
                  >
                    <option value="course">One course</option>
                    {role === 'org_admin' && (
                      <>
                        <option value="org_all">Everyone in the organization</option>
                        <option value="org_students">All students</option>
                        <option value="org_teachers">All teachers and administrators</option>
                      </>
                    )}
                  </Select>
                )}
              </Field>
              {audience === 'course' && (
                <Field label="Course">
                  {({ id }) => (
                    <Select id={id} value={effectiveCourseId} onChange={(e) => setCourseId(e.target.value)}>
                      {manageable.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} · {c.title}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
            </div>
            <Field label="Title" required>
              {({ id }) => (
                <Input
                  id={id}
                  value={title}
                  maxLength={LIMITS.announcementTitle}
                  onChange={(e) => setTitle(e.target.value)}
                />
              )}
            </Field>
            <Field label="Message" required hint="Markdown supported. HTML is not rendered.">
              {({ id, describedBy }) => (
                <Textarea
                  id={id}
                  className="min-h-40"
                  aria-describedby={describedBy}
                  maxLength={LIMITS.announcementBody}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Publish later (optional)" hint="Blank: publish now.">
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    type="datetime-local"
                    aria-describedby={describedBy}
                    value={publishAt}
                    onChange={(e) => setPublishAt(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Hide after (optional)">
                {({ id }) => (
                  <Input
                    id={id}
                    type="datetime-local"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
              <Checkbox
                label="Also send by email"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
              />
              <Checkbox
                label="Ask readers to acknowledge"
                checked={requireAck}
                onChange={(e) => setRequireAck(e.target.checked)}
              />
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

export function AnnouncementDetailPage() {
  const { announcementId = '' } = useParams();
  const { api, path } = useOrg();
  const qc = useQueryClient();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const q = useQuery({
    queryKey: ['org', api, 'announcements', announcementId],
    queryFn: () => get<AnnouncementDTO>(`${api}/announcements/${announcementId}`),
  });
  const markRead = useMutation({ mutationFn: () => post(`${api}/announcements/${announcementId}/read`) });
  const ack = useMutation({
    mutationFn: () => post(`${api}/announcements/${announcementId}/acknowledge`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org', api, 'announcements'] }),
  });
  const action = useMutation({
    mutationFn: (kind: 'publish' | 'archive') => post(`${api}/announcements/${announcementId}/${kind}`),
    onSuccess: async () => {
      setArchiveOpen(false);
      await qc.invalidateQueries({ queryKey: ['org', api, 'announcements'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Action failed.'),
  });
  const a = q.data;
  useEffect(() => {
    if (a && !a.canManage && !a.readAt && !markRead.isPending && !markRead.isSuccess) markRead.mutate();
  }, [a, markRead]);
  if (q.isPending) return <SkeletonRows rows={5} />;
  if (q.error || !a) return <ErrorState error={q.error} />;
  return (
    <div className="max-w-3xl">
      <PageHeader
        breadcrumbs={[{ label: 'Announcements', to: path('/announcements') }, { label: a.title }]}
        title={a.title}
        description={`${a.courseCode ?? AUDIENCE_LABEL[a.audience]} · ${a.author?.name ?? 'Staff'} · ${a.publishedAt ? formatDateTime(a.publishedAt) : a.status}`}
        actions={
          a.canManage && (
            <>
              {(a.status === 'draft' || a.status === 'scheduled') && (
                <Button loading={action.isPending} onClick={() => action.mutate('publish')}>
                  Publish now
                </Button>
              )}
              {a.status !== 'archived' && (
                <Button variant="secondary" onClick={() => setArchiveOpen(true)}>
                  Archive
                </Button>
              )}
            </>
          )
        }
      />
      {a.stats && (
        <Alert tone="info" className="mb-4">
          Read by {a.stats.read} {a.requireAck ? `· acknowledged by ${a.stats.acknowledged}` : ''}
          {a.publishAt && a.status === 'scheduled' ? ` · scheduled for ${formatDateTime(a.publishAt)}` : ''}
          {a.expiresAt ? ` · hidden after ${formatDateTime(a.expiresAt)}` : ''}
        </Alert>
      )}
      <Card>
        <CardBody>
          <Markdown>{a.body}</Markdown>
        </CardBody>
      </Card>
      {a.requireAck && !a.canManage && (
        <div className="mt-4">
          {a.acknowledgedAt ? (
            <p className="text-sm text-fg-muted">
              You acknowledged this on {formatDateTime(a.acknowledgedAt)}.
            </p>
          ) : (
            <Button loading={ack.isPending} onClick={() => ack.mutate()}>
              I have read this
            </Button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Archive this announcement?"
        description="Recipients will no longer see it. It stays in the archive for your records."
        confirmLabel="Archive"
        tone="danger"
        pending={action.isPending}
        onConfirm={() => action.mutate('archive')}
      />
    </div>
  );
}
