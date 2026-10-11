import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileClock } from '../../components/ui/icons';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import type { ExtensionRequestDTO, Paginated } from '@sat/shared';
import { useOrg } from '../../app/org';
import { Button } from '../../components/ui/button';
import { Badge, EmptyState, ErrorState, SkeletonRows } from '../../components/ui/feedback';
import { Field, Input, Select, Textarea } from '../../components/ui/form';
import { PageHeader, Pagination } from '../../components/ui/layout';
import { Dialog } from '../../components/ui/overlay';
import { ApiError, get, post } from '../../lib/api';
import { formatDateTime, fromLocalInput, toLocalInput } from '../../lib/format';

const TONE = { pending: 'info', approved: 'success', denied: 'danger', cancelled: 'neutral' } as const;

export function ExtensionsPage() {
  const { api, path, role } = useOrg();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? (role === 'student' ? '' : 'pending');
  const page = Number(params.get('page') ?? 1);
  const [deciding, setDeciding] = useState<{
    request: ExtensionRequestDTO;
    decision: 'approve' | 'deny';
  } | null>(null);
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const q = useQuery({
    queryKey: ['org', api, 'extensions', { status, page }],
    queryFn: () =>
      get<Paginated<ExtensionRequestDTO>>(`${api}/extension-requests`, {
        status: status || undefined,
        page,
        pageSize: 25,
      }),
    placeholderData: keepPreviousData,
  });
  const decide = useMutation({
    mutationFn: () =>
      post(`${api}/extension-requests/${deciding?.request.id}/decide`, {
        decision: deciding?.decision,
        approvedDueAt: deciding?.decision === 'approve' && date ? fromLocalInput(date) : undefined,
        note,
      }),
    onSuccess: async () => {
      setDeciding(null);
      await qc.invalidateQueries({ queryKey: ['org', api] });
      toast.success('Decision saved and the student notified.');
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError
          ? (Object.values(e.fields)[0]?.[0] ?? e.message)
          : 'Could not save the decision.',
      ),
  });
  const instructor = role !== 'student';

  return (
    <div>
      <PageHeader
        title="Extension requests"
        description={
          instructor ? 'Requests from students in the courses you teach.' : 'Your requests for more time.'
        }
      />
      <div className="mb-4 w-48">
        <Field label="Status">
          {({ id }) => (
            <Select
              id={id}
              value={status}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                next.set('status', e.target.value);
                next.delete('page');
                setParams(next, { replace: true });
              }}
            >
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="denied">Declined</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          )}
        </Field>
      </div>
      {q.isPending && <SkeletonRows />}
      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data?.items.length === 0 && (
        <EmptyState
          icon={FileClock}
          title="No requests"
          description={
            instructor
              ? 'Nothing waiting for a decision.'
              : 'Request an extension from an assignment page when your instructor allows it.'
          }
        />
      )}
      <ul className="space-y-3">
        {q.data?.items.map((r) => (
          <li key={r.id} className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">
                  {instructor && `${r.student.name} · `}
                  <Link to={path(`/assignments/${r.assignmentId}`)} className="hover:underline">
                    {r.courseCode} · {r.assignmentTitle}
                  </Link>
                </p>
                <p className="text-sm text-fg-muted">
                  Due {formatDateTime(r.originalDueAt)}, requested until {formatDateTime(r.requestedDueAt)} ·
                  sent {formatDateTime(r.createdAt)}
                </p>
              </div>
              <Badge tone={TONE[r.status]}>{r.status === 'denied' ? 'declined' : r.status}</Badge>
            </div>
            <p className="mt-2 text-sm whitespace-pre-wrap">{r.reason}</p>
            {r.status !== 'pending' && (r.decisionNote || r.approvedDueAt) && (
              <p className="mt-2 rounded-[var(--radius-control)] bg-surface-2 px-3 py-2 text-sm">
                {r.approvedDueAt && `New due date ${formatDateTime(r.approvedDueAt)}. `}
                {r.decisionNote}
                {r.decidedBy && <span className="text-fg-muted"> ({r.decidedBy.name})</span>}
              </p>
            )}
            {instructor && r.status === 'pending' && (
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setDate(toLocalInput(r.requestedDueAt));
                    setNote('');
                    setDeciding({ request: r, decision: 'approve' });
                  }}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setNote('');
                    setDeciding({ request: r, decision: 'deny' });
                  }}
                >
                  Decline
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {q.data && (
        <Pagination
          page={q.data.page}
          totalPages={q.data.totalPages}
          total={q.data.total}
          onPage={(p) => setParams({ status, page: String(p) })}
        />
      )}
      <Dialog
        open={deciding != null}
        onOpenChange={(o) => !o && setDeciding(null)}
        title={deciding?.decision === 'approve' ? 'Approve extension' : 'Decline extension'}
        description={
          deciding
            ? `${deciding.request.student.name} asked for more time on ${deciding.request.assignmentTitle}.`
            : undefined
        }
        footer={
          <Button
            variant={deciding?.decision === 'deny' ? 'danger' : 'primary'}
            loading={decide.isPending}
            onClick={() => decide.mutate()}
          >
            {deciding?.decision === 'approve' ? 'Approve' : 'Decline'}
          </Button>
        }
      >
        <div className="space-y-4">
          {deciding?.decision === 'approve' && (
            <Field label="New due date" hint="Defaults to the requested date. Shown in your time zone.">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  type="datetime-local"
                  aria-describedby={describedBy}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              )}
            </Field>
          )}
          <Field label="Note to the student (optional)">
            {({ id }) => (
              <Textarea id={id} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
            )}
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
