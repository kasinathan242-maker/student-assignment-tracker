import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from '../../components/ui/icons';
import { useState } from 'react';
import { toast } from 'sonner';
import type { HealthDTO, Paginated, PlatformOrgDTO, PlatformUserDTO } from '@sat/shared';
import { useMe } from '../../app/session';
import { Button } from '../../components/ui/button';
import { Badge, EmptyState, ErrorState, SkeletonRows } from '../../components/ui/feedback';
import { Field, FormError, Input, Select } from '../../components/ui/form';
import { PageHeader, Pagination, Table, Td, Th } from '../../components/ui/layout';
import { ConfirmDialog, Dialog } from '../../components/ui/overlay';
import { ApiError, get, patch, post } from '../../lib/api';
import { browserZone, formatDate, formatRelative } from '../../lib/format';
import { useDebounced } from '../../lib/useDebounced';
import { AuditTable } from '../admin/AdminPages';

const errMsg = (e: unknown, fallback: string) =>
  e instanceof ApiError ? (Object.values(e.fields)[0]?.[0] ?? e.message) : fallback;

export function PlatformOrgsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const search = useDebounced(q, 300);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', timezone: browserZone(), adminEmail: '' });
  const [error, setError] = useState<string | null>(null);
  const [statusFor, setStatusFor] = useState<PlatformOrgDTO | null>(null);
  const list = useQuery({
    queryKey: ['platform', 'orgs', { search, page }],
    queryFn: () => get<Paginated<PlatformOrgDTO>>('/platform/orgs', { q: search, page, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });
  const create = useMutation({
    mutationFn: () => post('/platform/orgs', form),
    onSuccess: async () => {
      setCreating(false);
      setForm({ name: '', slug: '', timezone: browserZone(), adminEmail: '' });
      await qc.invalidateQueries({ queryKey: ['platform', 'orgs'] });
      toast.success('Organization created and the administrator invited.');
    },
    onError: (e) => setError(errMsg(e, 'Could not create the organization.')),
  });
  const setStatus = useMutation({
    mutationFn: ({ org, reason }: { org: PlatformOrgDTO; reason: string }) =>
      patch(`/platform/orgs/${org.id}/status`, {
        status: org.status === 'active' ? 'suspended' : 'active',
        reason,
      }),
    onSuccess: async () => {
      setStatusFor(null);
      await qc.invalidateQueries({ queryKey: ['platform', 'orgs'] });
    },
    onError: (e) => toast.error(errMsg(e, 'Action failed.')),
  });
  return (
    <div>
      <PageHeader
        title="Organizations"
        description="Platform administrators manage the tenant registry. Academic records inside each organization are not accessible from here."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> New organization
          </Button>
        }
      />
      <div className="mb-4 w-72">
        <Field label="Search">
          {({ id }) => (
            <Input
              id={id}
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          )}
        </Field>
      </div>
      {list.isPending && <SkeletonRows />}
      {list.error && <ErrorState error={list.error} />}
      {list.data?.items.length === 0 && <EmptyState title="No organizations" />}
      {list.data && list.data.items.length > 0 && (
        <>
          <Table caption="Organizations">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Identifier</Th>
                <Th>Members</Th>
                <Th>Courses</Th>
                <Th>Status</Th>
                <Th>Created</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((o) => (
                <tr key={o.id}>
                  <Td className="font-medium">{o.name}</Td>
                  <Td className="font-mono text-xs">{o.slug}</Td>
                  <Td className="tabular">{o.memberCount}</Td>
                  <Td className="tabular">{o.courseCount}</Td>
                  <Td>
                    <Badge tone={o.status === 'active' ? 'success' : 'warning'}>{o.status}</Badge>
                  </Td>
                  <Td>{formatDate(o.createdAt)}</Td>
                  <Td className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setStatusFor(o)}>
                      {o.status === 'active' ? 'Suspend' : 'Reactivate'}
                    </Button>
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
        open={creating}
        onOpenChange={(o) => {
          setCreating(o);
          setError(null);
        }}
        title="New organization"
        description="The first administrator receives an invitation email."
        footer={
          <Button loading={create.isPending} onClick={() => create.mutate()}>
            Create
          </Button>
        }
      >
        <div className="space-y-4">
          <FormError message={error} />
          <Field label="Name" required>
            {({ id }) => (
              <Input id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            )}
          </Field>
          <Field label="Identifier" required hint="Lowercase letters, numbers and hyphens.">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })}
              />
            )}
          </Field>
          <Field label="Time zone">
            {({ id }) => (
              <Select
                id={id}
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              >
                {Intl.supportedValuesOf('timeZone').map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Administrator email" required>
            {({ id }) => (
              <Input
                id={id}
                type="email"
                value={form.adminEmail}
                onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
              />
            )}
          </Field>
        </div>
      </Dialog>
      {statusFor && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setStatusFor(null)}
          title={
            statusFor.status === 'active' ? `Suspend ${statusFor.name}?` : `Reactivate ${statusFor.name}?`
          }
          description={
            statusFor.status === 'active'
              ? 'Members lose access until the organization is reactivated. No data is deleted.'
              : 'Members regain access.'
          }
          confirmLabel={statusFor.status === 'active' ? 'Suspend' : 'Reactivate'}
          tone={statusFor.status === 'active' ? 'danger' : 'primary'}
          requireReason
          pending={setStatus.isPending}
          onConfirm={(reason) => setStatus.mutate({ org: statusFor, reason })}
        />
      )}
    </div>
  );
}

export function PlatformUsersPage() {
  const me = useMe();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const search = useDebounced(q, 300);
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<{
    user: PlatformUserDTO;
    kind: 'grant' | 'revoke' | 'suspend' | 'reactivate';
  } | null>(null);
  const list = useQuery({
    queryKey: ['platform', 'users', { search, page }],
    queryFn: () => get<Paginated<PlatformUserDTO>>('/platform/users', { q: search, page, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });
  const run = useMutation({
    mutationFn: ({ reason }: { reason: string }) => {
      if (!pending) throw new Error('none');
      const { user, kind } = pending;
      if (kind === 'grant' || kind === 'revoke')
        return post(`/platform/users/${user.id}/platform-role`, { grant: kind === 'grant', reason });
      return patch(`/platform/users/${user.id}/status`, {
        status: kind === 'suspend' ? 'suspended' : 'active',
        reason,
      });
    },
    onSuccess: async () => {
      setPending(null);
      await qc.invalidateQueries({ queryKey: ['platform', 'users'] });
      toast.success('Account updated. Its sessions were signed out.');
    },
    onError: (e) => toast.error(errMsg(e, 'Action failed.')),
  });
  return (
    <div>
      <PageHeader
        title="Accounts"
        description="Platform role changes and account suspensions require a reason and are audited."
      />
      <div className="mb-4 w-72">
        <Field label="Search">
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
      </div>
      {list.isPending && <SkeletonRows />}
      {list.error && <ErrorState error={list.error} />}
      {list.data && list.data.items.length > 0 && (
        <>
          <Table caption="Accounts">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Status</Th>
                <Th>Organizations</Th>
                <Th>Last sign-in</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((u) => (
                <tr key={u.id}>
                  <Td>
                    <span className="font-medium">{u.name}</span>
                    {u.platformRole && (
                      <Badge tone="accent" className="ml-2">
                        Platform admin
                      </Badge>
                    )}
                    <span className="block text-xs text-fg-muted">
                      {u.email}
                      {u.emailVerified ? '' : ' · unverified'}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={u.status === 'active' ? 'success' : 'warning'}>{u.status}</Badge>
                  </Td>
                  <Td className="tabular">{u.membershipCount}</Td>
                  <Td>{u.lastLoginAt ? formatRelative(u.lastLoginAt) : 'Never'}</Td>
                  <Td className="text-right whitespace-nowrap">
                    {u.id !== me.data?.user.id && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPending({ user: u, kind: u.platformRole ? 'revoke' : 'grant' })}
                        >
                          {u.platformRole ? 'Remove admin' : 'Make admin'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setPending({ user: u, kind: u.status === 'active' ? 'suspend' : 'reactivate' })
                          }
                        >
                          {u.status === 'active' ? 'Suspend' : 'Reactivate'}
                        </Button>
                      </>
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
      {pending && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setPending(null)}
          title={
            {
              grant: 'Grant platform administrator?',
              revoke: 'Remove platform administrator?',
              suspend: 'Suspend this account?',
              reactivate: 'Reactivate this account?',
            }[pending.kind]
          }
          description={`${pending.user.name} (${pending.user.email}). All of their sessions will be signed out.`}
          confirmLabel="Confirm"
          tone={pending.kind === 'grant' || pending.kind === 'reactivate' ? 'primary' : 'danger'}
          requireReason
          pending={run.isPending}
          onConfirm={(reason) => run.mutate({ reason })}
        />
      )}
    </div>
  );
}

export function PlatformAuditPage() {
  return (
    <AuditTable
      endpoint="/platform/audit-logs"
      title="Platform audit"
      description="Audit records across all organizations."
    />
  );
}

export function PlatformHealthPage() {
  const q = useQuery({
    queryKey: ['platform', 'health'],
    queryFn: () => get<HealthDTO>('/platform/health'),
    refetchInterval: 30_000,
  });
  if (q.isPending) return <SkeletonRows />;
  if (q.error) return <ErrorState error={q.error} />;
  const tone = (s: string) =>
    s === 'ok' ? 'success' : s === 'disabled' ? 'neutral' : s === 'degraded' ? 'warning' : 'danger';
  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Service health"
        description={`Version ${q.data.version} · up ${Math.round(q.data.uptimeSeconds / 60)} minutes · refreshes every 30 seconds`}
        actions={<Badge tone={tone(q.data.status)}>{q.data.status}</Badge>}
      />
      <ul className="divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
        {Object.entries(q.data.checks).map(([name, c]) => (
          <li key={name} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <span>
              <span className="font-medium capitalize">{name}</span>
              {c.detail && <span className="block text-fg-muted">{c.detail}</span>}
            </span>
            <Badge tone={tone(c.status)}>{c.status}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
