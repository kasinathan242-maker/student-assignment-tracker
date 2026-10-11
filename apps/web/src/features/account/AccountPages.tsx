import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Download, Monitor } from '../../components/ui/icons';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  LIMITS,
  NOTIFICATION_PREFERENCE_KEYS,
  newPasswordSchema,
  type NotificationDTO,
  type NotificationPreferenceKey,
  type NotificationPreferencesDTO,
  type Paginated,
  type SessionDTO,
} from '@sat/shared';
import { meKey, useLogout, useMe } from '../../app/session';
import { Button } from '../../components/ui/button';
import { Badge, EmptyState, ErrorState, SkeletonRows } from '../../components/ui/feedback';
import { Field, FormError, Input, Select } from '../../components/ui/form';
import { Card, CardBody, CardHeader, PageHeader, Pagination } from '../../components/ui/layout';
import { ConfirmDialog } from '../../components/ui/overlay';
import { ApiError, del, get, patch, post, put, upload } from '../../lib/api';
import { applyServerErrors, parseReminderHours } from '../../lib/forms';
import { formatDateTime, formatRelative } from '../../lib/format';
import { cn } from '../../lib/cn';

export function NotificationsPage() {
  const qc = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['notifications', 'list', { unreadOnly, page }],
    queryFn: () =>
      get<Paginated<NotificationDTO>>('/notifications', {
        unreadOnly: unreadOnly ? 'true' : undefined,
        page,
        pageSize: 25,
      }),
    placeholderData: keepPreviousData,
  });
  const read = useMutation({
    mutationFn: (id: string) => post(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const readAll = useMutation({
    mutationFn: () => post('/notifications/read-all', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Notifications"
        actions={
          <>
            <Button
              variant="secondary"
              aria-pressed={unreadOnly}
              onClick={() => {
                setUnreadOnly((v) => !v);
                setPage(1);
              }}
            >
              {unreadOnly ? 'Show all' : 'Unread only'}
            </Button>
            <Button variant="secondary" loading={readAll.isPending} onClick={() => readAll.mutate()}>
              Mark all read
            </Button>
          </>
        }
      />
      {q.isPending && <SkeletonRows />}
      {q.error && <ErrorState error={q.error} />}
      {q.data?.items.length === 0 && (
        <EmptyState
          icon={Bell}
          title="Nothing here"
          description="Notifications about assignments, grades and announcements appear here."
        />
      )}
      <ul className="divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
        {q.data?.items.map((n) => (
          <li key={n.id} className="flex gap-3 px-4 py-3">
            <span
              className={cn('mt-2 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-accent')}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              {n.link ? (
                <Link
                  to={n.link}
                  onClick={() => !n.readAt && read.mutate(n.id)}
                  className={cn('hover:underline', !n.readAt && 'font-semibold')}
                >
                  {n.title}
                </Link>
              ) : (
                <span className={cn(!n.readAt && 'font-semibold')}>{n.title}</span>
              )}
              {!n.readAt && <span className="sr-only"> (unread)</span>}
              {n.body && <p className="text-sm text-fg-muted">{n.body}</p>}
              <p className="text-xs text-fg-subtle">{formatDateTime(n.createdAt)}</p>
            </div>
            {!n.readAt && (
              <Button variant="ghost" size="sm" onClick={() => read.mutate(n.id)}>
                Mark read
              </Button>
            )}
          </li>
        ))}
      </ul>
      {q.data && (
        <Pagination page={q.data.page} totalPages={q.data.totalPages} total={q.data.total} onPage={setPage} />
      )}
    </div>
  );
}

const profileSchema = z.object({
  name: z.string().trim().min(1, 'Required').max(LIMITS.name),
  timezone: z.string().min(1),
  locale: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/),
});

export function ProfilePage() {
  const me = useMe();
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const user = me.data?.user;
  const form = useForm<z.input<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    values: { name: user?.name ?? '', timezone: user?.timezone ?? 'UTC', locale: user?.locale ?? 'en' },
  });
  const save = useMutation({
    mutationFn: (v: z.input<typeof profileSchema>) => patch('/me', v),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: meKey });
      toast.success('Profile saved.');
    },
    onError: (e) => setFormError(applyServerErrors(form, e)),
  });
  const avatar = useMutation({
    mutationFn: (file: File) =>
      file.size > LIMITS.avatarBytes
        ? Promise.reject(new ApiError(413, 'too_large', 'Choose an image under 2 MB.'))
        : upload('/me/avatar', file),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: meKey });
      toast.success('Profile image updated.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Upload failed.'),
  });
  const removeAvatar = useMutation({
    mutationFn: () => del('/me/avatar'),
    onSuccess: () => qc.invalidateQueries({ queryKey: meKey }),
  });
  if (!me.data || !user) return <SkeletonRows />;
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Profile" description={user.email} />
      <Card>
        <CardHeader title="Profile image" />
        <CardBody className="flex flex-wrap items-center gap-4">
          {user.hasAvatar ? (
            <img
              src={`/api/v1/users/${user.id}/avatar?v=${me.dataUpdatedAt}`}
              alt="Your profile"
              className="h-16 w-16 rounded-full object-cover"
            />
          ) : (
            <span
              className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-lg font-semibold text-accent-soft-fg"
              aria-hidden
            >
              {user.name
                .split(/\s+/)
                .map((p) => p[0])
                .slice(0, 2)
                .join('')
                .toUpperCase()}
            </span>
          )}
          <label className="inline-flex h-9.5 cursor-pointer items-center rounded-[var(--radius-control)] border border-border-strong px-4 text-sm font-medium hover:bg-surface-2 focus-within:outline-2 focus-within:outline-ring">
            {avatar.isPending ? 'Uploading…' : 'Upload image'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) avatar.mutate(file);
              }}
            />
          </label>
          {user.hasAvatar && (
            <Button variant="ghost" onClick={() => removeAvatar.mutate()}>
              Remove
            </Button>
          )}
          <p className="w-full text-sm text-fg-muted">
            PNG, JPEG or WebP, up to 2 MB. Visible to members of your organizations.
          </p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Details" />
        <CardBody>
          <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))}>
            <FormError message={formError} />
            <Field label="Full name" error={form.formState.errors.name?.message}>
              {({ id, invalid }) => <Input id={id} aria-invalid={invalid} {...form.register('name')} />}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Time zone" hint="All dates are shown in this time zone.">
                {({ id, describedBy }) => (
                  <Select id={id} aria-describedby={describedBy} {...form.register('timezone')}>
                    {Intl.supportedValuesOf('timeZone').map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Language">
                {({ id }) => (
                  <Select id={id} {...form.register('locale')}>
                    <option value="en">English</option>
                    <option value="en-GB">English (UK)</option>
                    <option value="en-IN">English (India)</option>
                  </Select>
                )}
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" loading={save.isPending}>
                Save profile
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
      {me.data.memberships.length > 0 && (
        <Card>
          <CardHeader title="Organizations" />
          <CardBody>
            <ul className="divide-y divide-border text-sm">
              {me.data.memberships.map((m) => (
                <li key={m.id} className="flex items-center justify-between py-2">
                  <span>
                    {m.orgName}
                    {m.studentNumber && <span className="text-fg-muted"> · {m.studentNumber}</span>}
                  </span>
                  <span className="flex gap-2">
                    <Badge>{m.role.replace('_', ' ')}</Badge>
                    {m.status !== 'active' && <Badge tone="warning">{m.status}</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

const CATEGORY_LABEL: Record<NotificationPreferenceKey, string> = {
  assignments: 'New and updated assignments',
  deadlines: 'Deadline reminders and changes',
  submissions: 'Submission confirmations',
  grades: 'Grades, feedback and revision requests',
  extensions: 'Extension requests and decisions',
  announcements: 'Announcements',
  enrollment: 'Invitations and enrollment',
};

export function NotificationPreferencesPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['me', 'notification-preferences'],
    queryFn: () => get<NotificationPreferencesDTO>('/me/notification-preferences'),
  });
  const [draft, setDraft] = useState<NotificationPreferencesDTO | null>(null);
  const [customReminders, setCustomReminders] = useState<string | null>(null);
  const prefs = draft ?? q.data;
  const save = useMutation({
    mutationFn: () => {
      if (!prefs) throw new Error('not loaded');
      const text =
        customReminders ??
        (prefs.reminderOffsetsMinutes ? prefs.reminderOffsetsMinutes.map((m) => m / 60).join(', ') : '');
      // Empty means "use the organization's default"; anything typed must be valid.
      const parsed = text.trim() ? parseReminderHours(text) : null;
      if (parsed && 'error' in parsed)
        throw new ApiError(400, 'validation_failed', `Reminders: ${parsed.error}`);
      const offsets = parsed && parsed.minutes.length > 0 ? parsed.minutes : null;
      return put<NotificationPreferencesDTO>('/me/notification-preferences', {
        inApp: prefs.inApp,
        email: prefs.email,
        reminderOffsetsMinutes: offsets,
      });
    },
    onSuccess: async () => {
      setDraft(null);
      setCustomReminders(null);
      await qc.invalidateQueries({ queryKey: ['me', 'notification-preferences'] });
      toast.success('Preferences saved.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save.'),
  });
  if (q.isPending) return <SkeletonRows />;
  if (q.error || !prefs) return <ErrorState error={q.error} />;
  const toggle = (channel: 'inApp' | 'email', key: NotificationPreferenceKey, value: boolean) =>
    setDraft({ ...prefs, [channel]: { ...prefs[channel], [key]: value } });
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Notification preferences"
        description="Security notices (such as password changes) are always sent."
      />
      <Card>
        <table className="w-full text-sm">
          <caption className="sr-only">Notification channels</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs text-fg-muted">
              <th scope="col" className="px-4 py-2 font-medium">
                Category
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                In app
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Email
              </th>
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_PREFERENCE_KEYS.map((k) => (
              <tr key={k} className="border-b border-border last:border-b-0">
                <th scope="row" className="px-4 py-2.5 text-left font-normal">
                  {CATEGORY_LABEL[k]}
                </th>
                <td className="px-4 py-2.5">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--accent)]"
                    aria-label={`${CATEGORY_LABEL[k]} in app`}
                    checked={prefs.inApp[k]}
                    onChange={(e) => toggle('inApp', k, e.target.checked)}
                  />
                </td>
                <td className="px-4 py-2.5">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--accent)]"
                    aria-label={`${CATEGORY_LABEL[k]} by email`}
                    checked={prefs.email[k]}
                    onChange={(e) => toggle('email', k, e.target.checked)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <CardHeader title="Reminder timing" />
        <CardBody>
          <Field
            label="Remind me this many hours before a deadline"
            hint={`Comma-separated. Leave blank to use your organization's default (${prefs.effectiveReminderOffsetsMinutes.map((m) => m / 60).join(', ')} hours).`}
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={
                  customReminders ??
                  (prefs.reminderOffsetsMinutes
                    ? prefs.reminderOffsetsMinutes.map((m) => m / 60).join(', ')
                    : '')
                }
                onChange={(e) => setCustomReminders(e.target.value)}
              />
            )}
          </Field>
        </CardBody>
      </Card>
      <div className="flex justify-end">
        <Button
          loading={save.isPending}
          disabled={!draft && customReminders == null}
          onClick={() => save.mutate()}
        >
          Save preferences
        </Button>
      </div>
    </div>
  );
}

const passwordForm = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: newPasswordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export function SecurityPage() {
  const qc = useQueryClient();
  const logout = useLogout();
  const [formError, setFormError] = useState<string | null>(null);
  const [revokeOthers, setRevokeOthers] = useState(false);
  const form = useForm<z.input<typeof passwordForm>>({
    resolver: zodResolver(passwordForm),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });
  const sessions = useQuery({
    queryKey: ['me', 'sessions'],
    queryFn: () => get<SessionDTO[]>('/me/sessions'),
  });
  const change = useMutation({
    mutationFn: (v: z.input<typeof passwordForm>) =>
      put('/me/password', { currentPassword: v.currentPassword, newPassword: v.newPassword }),
    onSuccess: async () => {
      form.reset();
      setFormError(null);
      await qc.invalidateQueries({ queryKey: ['me', 'sessions'] });
      toast.success('Password changed. Other sessions were signed out.');
    },
    onError: (e) => setFormError(applyServerErrors(form, e)),
  });
  const revoke = useMutation({
    mutationFn: (s: SessionDTO) => del(`/me/sessions/${s.id}`),
    onSuccess: async (_d, s) => {
      if (s.current) logout.mutate();
      else await qc.invalidateQueries({ queryKey: ['me', 'sessions'] });
    },
  });
  const others = useMutation({
    mutationFn: () => post<{ revoked: number }>('/me/sessions/revoke-others'),
    onSuccess: async (r) => {
      setRevokeOthers(false);
      await qc.invalidateQueries({ queryKey: ['me', 'sessions'] });
      toast.success(`${r.revoked} other session(s) signed out.`);
    },
  });
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Security" />
      <Card>
        <CardHeader title="Change password" />
        <CardBody>
          <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => change.mutate(v))}>
            <FormError message={formError} />
            <Field label="Current password" error={form.formState.errors.currentPassword?.message}>
              {({ id, invalid }) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="current-password"
                  aria-invalid={invalid}
                  {...form.register('currentPassword')}
                />
              )}
            </Field>
            <Field
              label="New password"
              hint={`At least ${LIMITS.passwordMin} characters.`}
              error={form.formState.errors.newPassword?.message}
            >
              {({ id, invalid, describedBy }) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="new-password"
                  aria-invalid={invalid}
                  aria-describedby={describedBy}
                  {...form.register('newPassword')}
                />
              )}
            </Field>
            <Field label="Confirm new password" error={form.formState.errors.confirm?.message}>
              {({ id, invalid }) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="new-password"
                  aria-invalid={invalid}
                  {...form.register('confirm')}
                />
              )}
            </Field>
            <div className="flex justify-end">
              <Button type="submit" loading={change.isPending}>
                Change password
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Signed-in sessions"
          actions={
            <Button
              variant="secondary"
              size="sm"
              disabled={(sessions.data?.length ?? 0) < 2}
              onClick={() => setRevokeOthers(true)}
            >
              Sign out other sessions
            </Button>
          }
        />
        <CardBody>
          {sessions.isPending && <SkeletonRows rows={2} />}
          <ul className="divide-y divide-border">
            {sessions.data?.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span className="flex min-w-0 items-start gap-3">
                  <Monitor className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{s.userAgent || 'Unknown device'}</span>
                    <span className="block text-fg-muted">
                      {s.ipPrefix || 'Unknown network'} · active {formatRelative(s.lastUsedAt)} · signed in{' '}
                      {formatDateTime(s.createdAt)}
                    </span>
                  </span>
                </span>
                {s.current ? (
                  <Badge tone="accent">This device</Badge>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => revoke.mutate(s)}>
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <ConfirmDialog
        open={revokeOthers}
        onOpenChange={setRevokeOthers}
        title="Sign out every other session?"
        description="Every other browser and device will need to sign in again."
        confirmLabel="Sign out others"
        tone="danger"
        pending={others.isPending}
        onConfirm={() => others.mutate()}
      />
    </div>
  );
}

export function DataExportPage() {
  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Download my data"
        description="A machine-readable copy of your account, memberships, enrollments, submissions, released grades, extension requests and notifications."
      />
      <Card>
        <CardBody className="space-y-3">
          <p className="text-sm">
            The file is generated on request and is not stored. It includes the text of your submissions and
            file names, but not the files themselves (download those from each assignment).
          </p>
          <a
            href="/api/v1/me/export"
            className="inline-flex h-9.5 items-center gap-2 rounded-[var(--radius-control)] bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover"
          >
            <Download className="h-4 w-4" aria-hidden /> Download JSON
          </a>
        </CardBody>
      </Card>
    </div>
  );
}
