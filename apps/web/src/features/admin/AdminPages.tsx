import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, MoreHorizontal, Plus, RefreshCw } from '../../components/ui/icons';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  LIMITS,
  type SELF_REGISTRATION_MODES,
  type AuditLogDTO,
  type DepartmentDTO,
  type InvitationDTO,
  type MemberDTO,
  type OrgDTO,
  type OrgRole,
  type OrgSettings,
  type Paginated,
} from '@sat/shared';
import { useOrg } from '../../app/org';
import { useMe } from '../../app/session';
import { Button } from '../../components/ui/button';
import { Alert, Badge, EmptyState, ErrorState, SkeletonRows } from '../../components/ui/feedback';
import { Checkbox, Field, FormError, Input, Select } from '../../components/ui/form';
import {
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Pagination,
  Table,
  Td,
  Th,
} from '../../components/ui/layout';
import {
  ConfirmDialog,
  Dialog,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from '../../components/ui/overlay';
import { ApiError, del, downloadUrl, get, patch, post } from '../../lib/api';
import { parseReminderHours } from '../../lib/forms';
import { formatDate, formatDateTime, formatRelative, fromLocalInput, ROLE_LABEL } from '../../lib/format';
import { useDebounced } from '../../lib/useDebounced';

/** First validation message, prefixed with the field's label when known ("settings.x.0" matches "settings.x"). */
const errMsg = (e: unknown, fallback: string, labels: Record<string, string> = {}) => {
  if (!(e instanceof ApiError)) return fallback;
  const [field, messages] = Object.entries(e.fields)[0] ?? [];
  if (!field || !messages?.[0]) return e.message;
  const label = labels[field.replace(/(.d+)+$/, '')];
  return label ? `${label}: ${messages[0]}` : messages[0];
};

const SETTINGS_LABELS: Record<string, string> = {
  name: 'Name',
  timezone: 'Default time zone',
  'settings.selfRegistration': 'Self-registration',
  'settings.allowedEmailDomains': 'Allowed email domains',
  'settings.reminderOffsetsMinutes': 'Deadline reminders',
  'settings.notificationRetentionDays': 'Keep notifications (days)',
  'settings.auditRetentionDays': 'Keep audit records (days)',
};

/* ───────────── members ───────────── */

type MemberAction = {
  member: MemberDTO;
  kind: 'role' | 'suspend' | 'reactivate' | 'revoke' | 'sessions' | 'approve';
  role?: OrgRole;
};

export function MembersPage() {
  const { api } = useOrg();
  const me = useMe();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const search = useDebounced(q, 300);
  const role = params.get('role') ?? '';
  const status = params.get('status') ?? '';
  const page = Number(params.get('page') ?? 1);
  const [action, setAction] = useState<MemberAction | null>(null);
  const list = useQuery({
    queryKey: ['org', api, 'members', { search, role, status, page }],
    queryFn: () =>
      get<Paginated<MemberDTO>>(`${api}/members`, {
        q: search,
        role: role || undefined,
        status: status || undefined,
        page,
        pageSize: 25,
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
  const run = useMutation({
    mutationFn: async ({ a, reason }: { a: MemberAction; reason: string }) => {
      const base = `${api}/members/${a.member.id}`;
      switch (a.kind) {
        case 'role':
          return patch(base, { role: a.role, reason });
        case 'suspend':
          return patch(base, { status: 'suspended', reason });
        case 'reactivate':
          return patch(base, { status: 'active', reason });
        case 'revoke':
          return del(base, { reason });
        case 'sessions':
          return post(`${base}/revoke-sessions`);
        case 'approve':
          return post(`${base}/approve`);
      }
    },
    onSuccess: async () => {
      setAction(null);
      await qc.invalidateQueries({ queryKey: ['org', api] });
      toast.success('Member updated.');
    },
    onError: (e) => toast.error(errMsg(e, 'Action failed.')),
  });
  const copy: Record<
    MemberAction['kind'],
    { title: string; description: string; confirm: string; reason: boolean; danger: boolean }
  > = {
    role: {
      title: `Change role to ${action?.role ? ROLE_LABEL[action.role] : ''}?`,
      description: 'Role changes take effect immediately and are recorded in the audit log.',
      confirm: 'Change role',
      reason: true,
      danger: false,
    },
    suspend: {
      title: 'Suspend this member?',
      description: 'They are signed out everywhere and cannot access the organization until reactivated.',
      confirm: 'Suspend',
      reason: true,
      danger: true,
    },
    reactivate: {
      title: 'Reactivate this member?',
      description: 'They regain access with their current role.',
      confirm: 'Reactivate',
      reason: true,
      danger: false,
    },
    revoke: {
      title: 'Remove from the organization?',
      description: 'Access is removed and course enrollments are dropped. Their records are kept.',
      confirm: 'Remove',
      reason: true,
      danger: true,
    },
    sessions: {
      title: 'Sign out of all sessions?',
      description:
        'Use this if you suspect the account is compromised. The member can sign in again with their password.',
      confirm: 'Sign out everywhere',
      reason: false,
      danger: true,
    },
    approve: {
      title: 'Approve membership?',
      description: 'They join as a student.',
      confirm: 'Approve',
      reason: false,
      danger: false,
    },
  };

  return (
    <div>
      <PageHeader
        title="Members"
        actions={
          <a
            className="inline-flex h-9.5 items-center gap-2 rounded-[var(--radius-control)] border border-border-strong px-4 text-sm font-medium hover:bg-surface-2"
            href={downloadUrl(`${api}/exports/members.csv`)}
          >
            <Download className="h-4 w-4" aria-hidden /> Export CSV
          </a>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label="Search">
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
        <Field label="Role">
          {({ id }) => (
            <Select id={id} value={role} onChange={(e) => set('role', e.target.value)}>
              <option value="">All roles</option>
              <option value="student">Students</option>
              <option value="teacher">Teachers</option>
              <option value="org_admin">Administrators</option>
            </Select>
          )}
        </Field>
        <Field label="Status">
          {({ id }) => (
            <Select id={id} value={status} onChange={(e) => set('status', e.target.value)}>
              <option value="">Any status</option>
              <option value="active">Active</option>
              <option value="pending">Awaiting approval</option>
              <option value="suspended">Suspended</option>
              <option value="revoked">Removed</option>
            </Select>
          )}
        </Field>
      </div>
      {list.isPending && <SkeletonRows rows={8} />}
      {list.error && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data?.items.length === 0 && <EmptyState title="No members match" />}
      {list.data && list.data.items.length > 0 && (
        <>
          <Table caption="Members">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th>Joined</Th>
                <Th>Last sign-in</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((m) => {
                const self = m.userId === me.data?.user.id;
                return (
                  <tr key={m.id}>
                    <Td>
                      <span className="font-medium">{m.name}</span>
                      {self && <span className="text-fg-muted"> (you)</span>}
                      <span className="block text-xs text-fg-muted">
                        {m.email}
                        {m.studentNumber ? ` · ${m.studentNumber}` : ''}
                      </span>
                    </Td>
                    <Td>{ROLE_LABEL[m.role]}</Td>
                    <Td>
                      <Badge
                        tone={
                          m.status === 'active'
                            ? 'success'
                            : m.status === 'pending'
                              ? 'info'
                              : m.status === 'suspended'
                                ? 'warning'
                                : 'neutral'
                        }
                      >
                        {m.status}
                      </Badge>
                    </Td>
                    <Td className="whitespace-nowrap">{formatDate(m.joinedAt)}</Td>
                    <Td className="whitespace-nowrap">
                      {m.lastLoginAt ? formatRelative(m.lastLoginAt) : 'Never'}
                    </Td>
                    <Td className="text-right">
                      {m.status === 'pending' ? (
                        <Button size="sm" onClick={() => setAction({ member: m, kind: 'approve' })}>
                          Approve
                        </Button>
                      ) : (
                        !self &&
                        m.status !== 'revoked' && (
                          <Menu>
                            <MenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label={`Actions for ${m.name}`}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </MenuTrigger>
                            <MenuContent>
                              {(['student', 'teacher', 'org_admin'] as const)
                                .filter((r) => r !== m.role)
                                .map((r) => (
                                  <MenuItem
                                    key={r}
                                    onSelect={() => setAction({ member: m, kind: 'role', role: r })}
                                  >
                                    Make {ROLE_LABEL[r].toLowerCase()}
                                  </MenuItem>
                                ))}
                              <MenuSeparator />
                              {m.status === 'suspended' ? (
                                <MenuItem onSelect={() => setAction({ member: m, kind: 'reactivate' })}>
                                  Reactivate
                                </MenuItem>
                              ) : (
                                <MenuItem onSelect={() => setAction({ member: m, kind: 'suspend' })}>
                                  Suspend
                                </MenuItem>
                              )}
                              <MenuItem onSelect={() => setAction({ member: m, kind: 'sessions' })}>
                                Sign out everywhere
                              </MenuItem>
                              <MenuItem danger onSelect={() => setAction({ member: m, kind: 'revoke' })}>
                                Remove from organization
                              </MenuItem>
                            </MenuContent>
                          </Menu>
                        )
                      )}
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
      {action && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setAction(null)}
          title={copy[action.kind].title}
          description={`${action.member.name} (${action.member.email}). ${copy[action.kind].description}`}
          confirmLabel={copy[action.kind].confirm}
          tone={copy[action.kind].danger ? 'danger' : 'primary'}
          requireReason={copy[action.kind].reason}
          pending={run.isPending}
          onConfirm={(reason) => run.mutate({ a: action, reason })}
        />
      )}
    </div>
  );
}

/* ───────────── invitations ───────────── */

export function InvitationsPage() {
  const { api } = useOrg();
  const qc = useQueryClient();
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('student');
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<InvitationDTO | null>(null);
  const list = useQuery({
    queryKey: ['org', api, 'invitations', { status, page }],
    queryFn: () =>
      get<Paginated<InvitationDTO>>(`${api}/invitations`, {
        status: status || undefined,
        page,
        pageSize: 25,
      }),
    placeholderData: keepPreviousData,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['org', api, 'invitations'] });
  const invite = useMutation({
    mutationFn: () => post(`${api}/invitations`, { email, role }),
    onSuccess: async () => {
      await refresh();
      toast.success(`Invitation sent to ${email}.`);
      setEmail('');
      setOpen(false);
    },
    onError: (e) => setError(errMsg(e, 'Could not send the invitation.')),
  });
  const resend = useMutation({
    mutationFn: (id: string) => post(`${api}/invitations/${id}/resend`),
    onSuccess: async () => {
      await refresh();
      toast.success('Invitation re-sent with a new link.');
    },
    onError: (e) => toast.error(errMsg(e, 'Could not resend.')),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => post(`${api}/invitations/${id}/revoke`),
    onSuccess: async () => {
      setRevoking(null);
      await refresh();
      toast.success('Invitation revoked.');
    },
  });
  return (
    <div>
      <PageHeader
        title="Invitations"
        description="Invitations expire after 7 days. The link in the email can only be used by the invited address."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Invite
          </Button>
        }
      />
      <div className="mb-4 w-48">
        <Field label="Status">
          {({ id }) => (
            <Select
              id={id}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="pending">Pending</option>
              <option value="accepted">Accepted</option>
              <option value="expired">Expired</option>
              <option value="revoked">Revoked</option>
              <option value="">All</option>
            </Select>
          )}
        </Field>
      </div>
      {list.isPending && <SkeletonRows />}
      {list.error && <ErrorState error={list.error} />}
      {list.data?.items.length === 0 && <EmptyState title="No invitations" />}
      {list.data && list.data.items.length > 0 && (
        <>
          <Table caption="Invitations">
            <thead>
              <tr>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th>Invited by</Th>
                <Th>Expires</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((i) => (
                <tr key={i.id}>
                  <Td className="font-medium">{i.email}</Td>
                  <Td>{ROLE_LABEL[i.role]}</Td>
                  <Td>
                    <Badge
                      tone={i.status === 'pending' ? 'info' : i.status === 'accepted' ? 'success' : 'neutral'}
                    >
                      {i.status}
                    </Badge>
                  </Td>
                  <Td>{i.invitedBy?.name ?? 'n/a'}</Td>
                  <Td className="whitespace-nowrap">{formatDateTime(i.expiresAt)}</Td>
                  <Td className="text-right whitespace-nowrap">
                    {(i.status === 'pending' || i.status === 'expired') && (
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={resend.isPending && resend.variables === i.id}
                        onClick={() => resend.mutate(i.id)}
                      >
                        <RefreshCw className="h-4 w-4" aria-hidden /> Resend
                      </Button>
                    )}
                    {i.status === 'pending' && (
                      <Button variant="ghost" size="sm" onClick={() => setRevoking(i)}>
                        Revoke
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            page={list.data.page}
            totalPages={list.data.totalPages}
            total={list.data.total}
            onPage={setPage}
          />
        </>
      )}
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          setError(null);
        }}
        title="Invite someone"
        footer={
          <Button loading={invite.isPending} disabled={!email} onClick={() => invite.mutate()}>
            Send invitation
          </Button>
        }
      >
        <div className="space-y-4">
          <FormError message={error} />
          <Field label="Email" required>
            {({ id }) => (
              <Input
                id={id}
                type="email"
                value={email}
                maxLength={LIMITS.email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Field label="Role">
            {({ id }) => (
              <Select id={id} value={role} onChange={(e) => setRole(e.target.value as OrgRole)}>
                <option value="student">Student</option>
                <option value="teacher">Teacher</option>
                <option value="org_admin">Administrator</option>
              </Select>
            )}
          </Field>
        </div>
      </Dialog>
      <ConfirmDialog
        open={revoking != null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Revoke this invitation?"
        description={`The link sent to ${revoking?.email ?? ''} will stop working.`}
        confirmLabel="Revoke"
        tone="danger"
        pending={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
      />
    </div>
  );
}

/* ───────────── departments ───────────── */

export function DepartmentsPage() {
  const { api } = useOrg();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['org', api, 'departments'],
    queryFn: () => get<DepartmentDTO[]>(`${api}/departments`),
  });
  const create = useMutation({
    mutationFn: () => post(`${api}/departments`, { name, code }),
    onSuccess: async () => {
      setName('');
      setCode('');
      setError(null);
      await qc.invalidateQueries({ queryKey: ['org', api, 'departments'] });
    },
    onError: (e) => setError(errMsg(e, 'Could not create the department.')),
  });
  const toggle = useMutation({
    mutationFn: (d: DepartmentDTO) =>
      patch(`${api}/departments/${d.id}`, { status: d.status === 'active' ? 'archived' : 'active' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org', api, 'departments'] }),
  });
  return (
    <div className="max-w-3xl">
      <PageHeader title="Departments" description="Group courses by department for reporting and browsing." />
      <Card className="mb-6">
        <CardBody>
          <form
            className="grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Field label="Code">
              {({ id }) => (
                <Input
                  id={id}
                  className="uppercase"
                  value={code}
                  maxLength={LIMITS.departmentCode}
                  onChange={(e) => setCode(e.target.value)}
                />
              )}
            </Field>
            <Field label="Name">
              {({ id }) => (
                <Input
                  id={id}
                  value={name}
                  maxLength={LIMITS.departmentName}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>
            <Button type="submit" loading={create.isPending} disabled={!name.trim() || !code.trim()}>
              Add department
            </Button>
          </form>
          <FormError message={error} />
        </CardBody>
      </Card>
      {list.isPending && <SkeletonRows />}
      {list.data?.length === 0 && <EmptyState title="No departments yet" />}
      <ul className="divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
        {list.data?.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <span>
              <span className="font-mono font-semibold">{d.code}</span> {d.name}{' '}
              <span className="tabular text-sm text-fg-muted">· {d.courseCount} courses</span>
              {d.status === 'archived' && <Badge className="ml-2">Archived</Badge>}
            </span>
            <Button variant="ghost" size="sm" onClick={() => toggle.mutate(d)}>
              {d.status === 'active' ? 'Archive' : 'Restore'}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────────── audit log ───────────── */

export function AuditLogPage() {
  const { api } = useOrg();
  return (
    <AuditTable
      endpoint={`${api}/audit-logs`}
      exportPath={`${api}/audit-logs.csv`}
      title="Audit log"
      description="Security-relevant and administrative actions in this organization."
    />
  );
}

export function AuditTable({
  endpoint,
  exportPath,
  title,
  description,
}: {
  endpoint: string;
  exportPath?: string;
  title: string;
  description: string;
}) {
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const debouncedAction = useDebounced(action, 400);
  const filters = {
    action: debouncedAction || undefined,
    from: fromLocalInput(from) ?? undefined,
    to: fromLocalInput(to) ?? undefined,
  };
  const list = useQuery({
    queryKey: ['audit', endpoint, filters, page],
    queryFn: () => get<Paginated<AuditLogDTO>>(endpoint, { ...filters, page, pageSize: 50 }),
    placeholderData: keepPreviousData,
  });
  const qs = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v) as [string, string][],
  ).toString();
  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={
          exportPath && (
            <a
              className="inline-flex h-9.5 items-center gap-2 rounded-[var(--radius-control)] border border-border-strong px-4 text-sm font-medium hover:bg-surface-2"
              href={`${downloadUrl(exportPath)}${qs ? `?${qs}` : ''}`}
            >
              <Download className="h-4 w-4" aria-hidden /> Export CSV
            </a>
          )
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label="Action" hint='Exact action, or a prefix ending in "." such as grade.'>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setPage(1);
              }}
            />
          )}
        </Field>
        <Field label="From">
          {({ id }) => (
            <Input
              id={id}
              type="datetime-local"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          )}
        </Field>
        <Field label="To">
          {({ id }) => (
            <Input
              id={id}
              type="datetime-local"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          )}
        </Field>
      </div>
      {list.isPending && <SkeletonRows rows={8} />}
      {list.error && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data?.items.length === 0 && <EmptyState title="No matching records" />}
      {list.data && list.data.items.length > 0 && (
        <>
          <Table caption={title}>
            <thead>
              <tr>
                <Th>Time</Th>
                <Th>Action</Th>
                <Th>Actor</Th>
                <Th>Target</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap">{formatDateTime(r.createdAt)}</Td>
                  <Td className="font-mono text-xs">{r.action}</Td>
                  <Td>
                    {r.actor ? `${r.actor.name}` : 'System'}
                    {r.ip && <span className="block text-xs text-fg-muted">{r.ip}</span>}
                  </Td>
                  <Td className="text-xs text-fg-muted">
                    {r.targetType ? `${r.targetType} ${r.targetId ?? ''}` : ''}
                  </Td>
                  <Td className="max-w-[24rem] truncate font-mono text-xs text-fg-muted">
                    <span title={JSON.stringify(r.metadata)}>
                      {Object.keys(r.metadata).length ? JSON.stringify(r.metadata) : ''}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            page={list.data.page}
            totalPages={list.data.totalPages}
            total={list.data.total}
            onPage={setPage}
          />
        </>
      )}
    </div>
  );
}

/* ───────────── organization settings ───────────── */

export function OrgSettingsPage() {
  const { api } = useOrg();
  const q = useQuery({ queryKey: ['org', api, 'profile'], queryFn: () => get<OrgDTO>(api) });
  if (q.isPending) return <SkeletonRows rows={8} />;
  if (q.error) return <ErrorState error={q.error} />;
  return <OrgSettingsForm key={q.dataUpdatedAt} org={q.data} />;
}

function OrgSettingsForm({ org }: { org: OrgDTO }) {
  const { api } = useOrg();
  const qc = useQueryClient();
  const [name, setName] = useState(org.name);
  const [timezone, setTimezone] = useState(org.timezone);
  const [settings, setSettings] = useState<OrgSettings>(org.settings);
  const [domains, setDomains] = useState(org.settings.allowedEmailDomains.join(', '));
  const [offsets, setOffsets] = useState(
    org.settings.reminderOffsetsMinutes.map((m) => String(m / 60)).join(', '),
  );
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const reminders = parseReminderHours(offsets);
      if ('error' in reminders)
        throw new ApiError(400, 'validation_failed', `Deadline reminders: ${reminders.error}`);
      return patch<OrgDTO>(api, {
        name,
        timezone,
        settings: {
          ...settings,
          allowedEmailDomains: domains
            .split(',')
            .map((d) => d.trim().toLowerCase())
            .filter(Boolean),
          reminderOffsetsMinutes: reminders.minutes,
        },
      });
    },
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ['org', api] });
      await qc.invalidateQueries({ queryKey: ['me'] });
      toast.success('Settings saved.');
    },
    onError: (e) => setError(errMsg(e, 'Could not save settings.', SETTINGS_LABELS)),
  });
  const joinCode = useMutation({
    mutationFn: (enabled: boolean) => post<OrgDTO>(`${api}/join-code`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org', api, 'profile'] }),
  });
  const set = <K extends keyof OrgSettings>(key: K, value: OrgSettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Organization settings" description={`Identifier: ${org.slug}`} />
      <FormError message={error} />
      <Card>
        <CardHeader title="Profile" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            {({ id }) => (
              <Input
                id={id}
                value={name}
                maxLength={LIMITS.orgName}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <Field label="Default time zone">
            {({ id }) => (
              <Select id={id} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {Intl.supportedValuesOf('timeZone').map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Joining" />
        <CardBody className="space-y-4">
          <Field label="Self-registration" hint="How people with a join code become members.">
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={settings.selfRegistration}
                onChange={(e) =>
                  set('selfRegistration', e.target.value as (typeof SELF_REGISTRATION_MODES)[number])
                }
              >
                <option value="disabled">Invitation only</option>
                <option value="approval">Join code, administrator approves</option>
                <option value="open">Join code, joins immediately as student</option>
              </Select>
            )}
          </Field>
          <Field
            label="Allowed email domains"
            hint="Comma-separated, e.g. university.edu. Blank: any domain."
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={domains}
                onChange={(e) => setDomains(e.target.value)}
              />
            )}
          </Field>
          {settings.selfRegistration !== 'disabled' && (
            <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] bg-surface-2 px-3 py-2 text-sm">
              <span>
                Join code:{' '}
                {org.joinCode ? <span className="font-mono font-semibold">{org.joinCode}</span> : 'none'}
              </span>
              <Button
                size="sm"
                variant="secondary"
                loading={joinCode.isPending}
                onClick={() => joinCode.mutate(true)}
              >
                {org.joinCode ? 'Rotate code' : 'Create code'}
              </Button>
              {org.joinCode && (
                <Button size="sm" variant="ghost" onClick={() => joinCode.mutate(false)}>
                  Disable code
                </Button>
              )}
            </div>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Academic defaults" />
        <CardBody className="space-y-4">
          <Checkbox
            label="Teachers can create courses"
            checked={settings.teachersCanCreateCourses}
            onChange={(e) => set('teachersCanCreateCourses', e.target.checked)}
          />
          <Checkbox
            label="Allow CSV roster imports"
            checked={settings.csvImportEnabled}
            onChange={(e) => set('csvImportEnabled', e.target.checked)}
          />
          <Field
            label="Deadline reminders (hours before due)"
            hint="Comma-separated, up to 5. Students can override this in their preferences."
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={offsets}
                onChange={(e) => setOffsets(e.target.value)}
              />
            )}
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Retention" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Keep notifications (days)">
            {({ id }) => (
              <Input
                id={id}
                type="number"
                min={7}
                max={730}
                value={settings.notificationRetentionDays}
                onChange={(e) => set('notificationRetentionDays', Number(e.target.value))}
              />
            )}
          </Field>
          <Field label="Keep audit records (days)">
            {({ id }) => (
              <Input
                id={id}
                type="number"
                min={90}
                max={3650}
                value={settings.auditRetentionDays}
                onChange={(e) => set('auditRetentionDays', Number(e.target.value))}
              />
            )}
          </Field>
        </CardBody>
      </Card>
      <Alert tone="info">Changes to retention apply to records created from now on.</Alert>
      <div className="flex justify-end">
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          Save settings
        </Button>
      </div>
    </div>
  );
}
