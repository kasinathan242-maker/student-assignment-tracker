import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Clock,
  Download,
  FileText,
  History,
  Link2,
  Paperclip,
  Trash2,
  Upload,
} from '../../components/ui/icons';
import { useEffect, useRef, useState } from 'react';
import { useBlocker, useNavigate } from 'react-router';
import { toast } from 'sonner';
import type {
  AssignmentDTO,
  ExtensionRequestDTO,
  FileDTO,
  MySubmissionDTO,
  Paginated,
  RubricDTO,
  SubmissionReceiptDTO,
  SubmissionVersionDTO,
} from '@sat/shared';
import { useOrg } from '../../app/org';
import { Button } from '../../components/ui/button';
import { Alert, Badge, ErrorState, SkeletonRows, SubmissionStatusBadge } from '../../components/ui/feedback';
import { Field, Input, Textarea } from '../../components/ui/form';
import { Card, CardBody, CardHeader, Markdown, PageHeader } from '../../components/ui/layout';
import { ConfirmDialog, Dialog } from '../../components/ui/overlay';
import { ApiError, del, downloadUrl, get, newIdempotencyKey, post, put, upload } from '../../lib/api';
import {
  formatBytes,
  formatDateTime,
  formatPoints,
  formatRelative,
  fromLocalInput,
  TYPE_LABEL,
} from '../../lib/format';
import { useDebounced } from '../../lib/useDebounced';

export function AttachmentList({ files, emptyText }: { files: FileDTO[]; emptyText?: string }) {
  if (files.length === 0) return emptyText ? <p className="text-sm text-fg-muted">{emptyText}</p> : null;
  return (
    <ul className="space-y-1.5">
      {files.map((f) => (
        <li key={f.id}>
          <a
            href={downloadUrl(f.downloadPath)}
            className="inline-flex items-center gap-2 text-sm font-medium text-accent hover:underline"
          >
            <Download className="h-4 w-4" aria-hidden />
            {f.name}
            <span className="font-normal text-fg-muted">({formatBytes(f.size)})</span>
          </a>
          {f.scanStatus === 'pending' && (
            <span className="ml-2 text-xs text-fg-muted">security scan pending</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function PolicySummary({ a }: { a: AssignmentDTO }) {
  const late =
    a.latePolicy.mode === 'reject'
      ? 'Late work is not accepted.'
      : a.latePolicy.mode === 'accept'
        ? `Late work is accepted${a.latePolicy.maxLateDays != null ? ` for up to ${a.latePolicy.maxLateDays} day(s)` : ''} without penalty.`
        : `Late work loses ${a.latePolicy.penaltyPercentPerDay}% per day late${a.latePolicy.maxLateDays != null ? `, accepted for up to ${a.latePolicy.maxLateDays} day(s)` : ''}.`;
  const resub = a.resubmission.allowed
    ? a.resubmission.maxAttempts
      ? `Up to ${a.resubmission.maxAttempts} attempts.`
      : 'Unlimited resubmissions before the deadline.'
    : 'One submission (your instructor may return it for revision).';
  const methods = [
    a.submissionMethods.text && 'written response',
    a.submissionMethods.file &&
      `files (${a.fileRules.allowedExtensions.join(', ')}; up to ${a.fileRules.maxFiles}, ${a.fileRules.maxFileSizeMb} MB each)`,
    a.submissionMethods.url && 'a link',
  ].filter(Boolean);
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-fg-muted">Points</dt>
        <dd className="tabular">{a.maxPoints}</dd>
      </div>
      <div>
        <dt className="text-fg-muted">Submit as</dt>
        <dd>{methods.join(', ')}</dd>
      </div>
      {a.availableFrom && (
        <div>
          <dt className="text-fg-muted">Opens</dt>
          <dd>{formatDateTime(a.availableFrom)}</dd>
        </div>
      )}
      {a.availableUntil && (
        <div>
          <dt className="text-fg-muted">Closes</dt>
          <dd>{formatDateTime(a.availableUntil)}</dd>
        </div>
      )}
      <div>
        <dt className="text-fg-muted">Late work</dt>
        <dd>
          {late}
          {a.gracePeriodMinutes > 0 && ` A ${a.gracePeriodMinutes}-minute grace period applies.`}
        </dd>
      </div>
      <div>
        <dt className="text-fg-muted">Attempts</dt>
        <dd>{resub}</dd>
      </div>
    </dl>
  );
}

export function RubricView({
  rubric,
  scores,
}: {
  rubric: {
    id: string;
    title: string;
    description?: string;
    maxPoints: number;
    levels: { title: string; points: number }[];
  }[];
  scores?: { criterionId: string; points: number; comment?: string }[];
}) {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Rubric</caption>
        <thead>
          <tr className="text-left text-xs text-fg-muted">
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Criterion
            </th>
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Levels
            </th>
            <th scope="col" className="py-1.5 text-right font-medium">
              {scores ? 'Score' : 'Max'}
            </th>
          </tr>
        </thead>
        <tbody>
          {rubric.map((c) => {
            const s = scores?.find((x) => x.criterionId === c.id);
            return (
              <tr key={c.id} className="border-t border-border align-top">
                <td className="py-2 pr-3">
                  <span className="font-medium">{c.title}</span>
                  {c.description && <span className="block text-fg-muted">{c.description}</span>}
                  {s?.comment && <span className="mt-1 block text-fg">{s.comment}</span>}
                </td>
                <td className="py-2 pr-3 text-fg-muted">
                  {c.levels.length
                    ? c.levels.map((l) => `${l.title} (${l.points})`).join(', ')
                    : 'Scored directly'}
                </td>
                <td className="tabular py-2 text-right whitespace-nowrap">
                  {s ? `${s.points} / ${c.maxPoints}` : c.maxPoints}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function useRubric(rubricId: string | null) {
  const { api } = useOrg();
  return useQuery({
    queryKey: ['org', api, 'rubrics', rubricId],
    queryFn: () => get<RubricDTO>(`${api}/rubrics/${rubricId}`),
    enabled: Boolean(rubricId),
  });
}

export function StudentAssignmentView({ assignment: a }: { assignment: AssignmentDTO }) {
  const { path } = useOrg();
  const rubric = useRubric(a.rubricId);
  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Assignments', to: path('/assignments') },
          { label: a.courseCode, to: path(`/courses/${a.courseId}`) },
          { label: a.title },
        ]}
        title={a.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {TYPE_LABEL[a.type]} · {a.courseTitle}
            {a.my && <SubmissionStatusBadge status={a.my.displayStatus} />}
          </span>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="space-y-6">
          <DueBanner a={a} />
          <Card>
            <CardHeader title="Instructions" />
            <CardBody className="space-y-4">
              {a.description && <p className="text-fg-muted">{a.description}</p>}
              {a.instructions ? (
                <Markdown>{a.instructions}</Markdown>
              ) : (
                !a.description && <p className="text-sm text-fg-muted">No written instructions.</p>
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
              {a.attachments.length > 0 && (
                <div>
                  <h3 className="mb-1 text-sm font-semibold">Reference files</h3>
                  <AttachmentList files={a.attachments} />
                </div>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Requirements" />
            <CardBody>
              <PolicySummary a={a} />
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
        <div className="space-y-6">
          <SubmissionPanel a={a} />
        </div>
      </div>
    </div>
  );
}

function DueBanner({ a }: { a: AssignmentDTO }) {
  const [now] = useState(() => Date.now());
  const my = a.my;
  if (!my) return null;
  const due = new Date(my.effectiveDueAt);
  const past = due.getTime() < now;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3">
      <span className="flex items-center gap-2 text-sm">
        <Clock className="h-4 w-4 text-fg-muted" aria-hidden />
        <span>
          <span className="font-semibold">
            {past ? 'Was due' : 'Due'} {formatDateTime(due)}
          </span>{' '}
          <span className="text-fg-muted">({formatRelative(due)})</span>
        </span>
      </span>
      {my.extensionDueAt && (
        <Badge tone="info">Extended for you (originally {formatDateTime(a.dueAt)})</Badge>
      )}
      {my.cutoffAt && my.cutoffAt !== my.effectiveDueAt && (
        <span className="text-sm text-fg-muted">Last accepted {formatDateTime(my.cutoffAt)}</span>
      )}
    </div>
  );
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function SubmissionPanel({ a }: { a: AssignmentDTO }) {
  const { api } = useOrg();
  const key = ['org', api, 'assignments', a.id, 'my-submission'];
  const q = useQuery({
    queryKey: key,
    queryFn: () => get<MySubmissionDTO>(`${api}/assignments/${a.id}/my-submission`),
    refetchOnWindowFocus: false,
  });
  if (q.isPending) return <SkeletonRows rows={5} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return <SubmissionEditor a={a} sub={q.data} />;
}

function SubmissionEditor({ a, sub }: { a: AssignmentDTO; sub: MySubmissionDTO }) {
  const { api, path } = useOrg();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const key = ['org', api, 'assignments', a.id, 'my-submission'];
  const base = `${api}/assignments/${a.id}/my-submission`;
  const [text, setText] = useState(sub.draft.text ?? '');
  const [url, setUrl] = useState(sub.draft.url ?? '');
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [conflict, setConflict] = useState(false);
  const rev = useRef(sub.rev);
  const exists = useRef(Boolean(sub.id));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const idempotencyKey = useRef<string>('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const debouncedText = useDebounced(text, 1200);
  const debouncedUrl = useDebounced(url, 1200);
  const editable = sub.state !== 'graded';

  useEffect(() => {
    rev.current = sub.rev;
    exists.current = Boolean(sub.id);
  }, [sub.rev, sub.id]);

  const apply = (data: MySubmissionDTO) => {
    rev.current = data.rev;
    exists.current = Boolean(data.id);
    qc.setQueryData(key, data);
  };

  const save = useMutation({
    mutationFn: (body: { text?: string | null; url?: string | null; fileIds?: string[] }) =>
      put<MySubmissionDTO>(`${base}/draft`, {
        ...body,
        ...(exists.current ? { expectedRev: rev.current } : {}),
      }),
    onMutate: () => setSaveState('saving'),
    onSuccess: (data) => {
      apply(data);
      setDirty(false);
      setSaveState('saved');
    },
    onError: (e) => {
      setSaveState('error');
      if (e instanceof ApiError && e.code === 'stale_revision') setConflict(true);
      else if (e instanceof ApiError && e.status === 400) toast.error(e.message);
    },
  });

  // Autosave after a pause in typing. A failed save keeps the local text and offers a retry.
  useEffect(() => {
    if (!dirty || !editable || conflict) return;
    save.mutate({
      text: a.submissionMethods.text ? debouncedText : undefined,
      url: a.submissionMethods.url ? debouncedUrl.trim() : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedText, debouncedUrl]);

  // Warn before leaving with unsaved changes (in-app navigation and tab close).
  const blocker = useBlocker(dirty && !conflict);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const uploadFile = async (file: File) => {
    if (file.size > a.fileRules.maxFileSizeMb * 1024 * 1024) {
      toast.error(`${file.name} is larger than ${a.fileRules.maxFileSizeMb} MB.`);
      return;
    }
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!a.fileRules.allowedExtensions.includes(ext)) {
      toast.error(`.${ext} files are not accepted. Allowed: ${a.fileRules.allowedExtensions.join(', ')}.`);
      return;
    }
    try {
      setUploadProgress(0);
      const uploaded = await upload<FileDTO>(`${base}/files`, file, setUploadProgress);
      const current = (qc.getQueryData<MySubmissionDTO>(key)?.draft.files ?? []).map((f) => f.id);
      await save.mutateAsync({ fileIds: [...current, uploaded.id] });
      toast.success(`${file.name} attached.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Upload failed. Please try again.');
    } finally {
      setUploadProgress(null);
    }
  };

  const removeFile = useMutation({
    mutationFn: (id: string) => del(`${base}/files/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not remove the file.'),
  });

  const submit = useMutation({
    mutationFn: () =>
      post<SubmissionReceiptDTO>(
        `${base}/submit`,
        { expectedRev: rev.current },
        { headers: { 'idempotency-key': idempotencyKey.current } },
      ),
    onSuccess: async (receipt) => {
      setConfirmOpen(false);
      await qc.invalidateQueries({ queryKey: ['org', api] });
      navigate(path(`/assignments/${a.id}/receipt`), { state: { receipt } });
    },
    onError: (e) => {
      // Network failures keep the dialog open; retrying reuses the same idempotency key, so a submission
      // that reached the server is never duplicated.
      if (e instanceof ApiError && e.isNetwork) return;
      setConfirmOpen(false);
      toast.error(e instanceof ApiError ? e.message : 'Submission failed.');
      void qc.invalidateQueries({ queryKey: key });
    },
  });

  const withdraw = useMutation({
    mutationFn: () => post<MySubmissionDTO>(`${base}/withdraw`, { expectedRev: rev.current }),
    onSuccess: (data) => {
      apply(data);
      setWithdrawOpen(false);
      toast.success('Submission withdrawn. Your draft is still here.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not withdraw.'),
  });

  const files = sub.draft.files;
  const busy = save.isPending || uploadProgress != null;
  const hasContent =
    (a.submissionMethods.text && text.trim()) ||
    (a.submissionMethods.url && url.trim()) ||
    (a.submissionMethods.file && files.length > 0);

  return (
    <>
      {sub.grade && (
        <Card>
          <CardHeader
            title="Grade and feedback"
            description={`Released ${formatDateTime(sub.grade.publishedAt)}${sub.grade.gradedBy ? ` by ${sub.grade.gradedBy.name}` : ''}`}
          />
          <CardBody className="space-y-4">
            <p className="tabular text-3xl font-semibold">
              {formatPoints(sub.grade.finalPoints, sub.grade.maxPoints)}{' '}
              <span className="text-base font-normal text-fg-muted">({sub.grade.percentage}%)</span>
            </p>
            {sub.grade.latePenaltyPoints > 0 && (
              <p className="text-sm text-fg-muted">
                Includes a late penalty of {sub.grade.latePenaltyPoints} point(s) from {sub.grade.rawPoints}.
              </p>
            )}
            {sub.grade.feedback && (
              <div>
                <h3 className="mb-1 text-sm font-semibold">Feedback</h3>
                <p className="text-sm whitespace-pre-wrap">{sub.grade.feedback}</p>
              </div>
            )}
            {sub.grade.rubric && <RubricView rubric={sub.grade.rubric} scores={sub.grade.rubricScores} />}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Your work" actions={<SubmissionStatusBadge status={sub.displayStatus} />} />
        <CardBody className="space-y-4">
          {sub.returnFeedback && (
            <Alert tone="warning" title="Your instructor asked for a revision">
              <p className="whitespace-pre-wrap">{sub.returnFeedback}</p>
            </Alert>
          )}
          {conflict && (
            <Alert tone="warning" title="Changed somewhere else">
              <p>
                This draft was updated in another tab or device. Reload to see the latest version before
                continuing.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setConflict(false);
                  setDirty(false);
                  void qc.invalidateQueries({ queryKey: key }).then(() => {
                    const fresh = qc.getQueryData<MySubmissionDTO>(key);
                    setText(fresh?.draft.text ?? '');
                    setUrl(fresh?.draft.url ?? '');
                  });
                }}
              >
                Reload draft
              </Button>
            </Alert>
          )}
          {!sub.timing.accepting && sub.timing.blockReason && (
            <Alert tone="info">{sub.timing.blockReason}</Alert>
          )}
          {sub.timing.accepting && sub.timing.wouldBeLate && editable && (
            <Alert tone="warning">
              The deadline has passed. If you submit now your work will be marked late.
            </Alert>
          )}

          {editable ? (
            <>
              {a.submissionMethods.text && (
                <Field label="Written response" hint="Saved automatically as you type.">
                  {({ id, describedBy }) => (
                    <Textarea
                      id={id}
                      aria-describedby={describedBy}
                      className="min-h-48"
                      value={text}
                      disabled={conflict}
                      onChange={(e) => {
                        setText(e.target.value);
                        setDirty(true);
                      }}
                    />
                  )}
                </Field>
              )}
              {a.submissionMethods.url && (
                <Field label="Link" hint="Make sure your instructor has permission to open it.">
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      type="url"
                      inputMode="url"
                      placeholder="https://"
                      aria-describedby={describedBy}
                      value={url}
                      disabled={conflict}
                      onChange={(e) => {
                        setUrl(e.target.value);
                        setDirty(true);
                      }}
                    />
                  )}
                </Field>
              )}
              {a.submissionMethods.file && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    Files{' '}
                    <span className="font-normal text-fg-muted">
                      ({files.length} of {a.fileRules.maxFiles})
                    </span>
                  </p>
                  <ul className="space-y-1.5">
                    {files.map((f) => (
                      <li
                        key={f.id}
                        className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border px-3 py-2 text-sm"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Paperclip className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
                          <a href={downloadUrl(f.downloadPath)} className="truncate hover:underline">
                            {f.name}
                          </a>
                          <span className="shrink-0 text-fg-muted">{formatBytes(f.size)}</span>
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${f.name}`}
                          loading={removeFile.isPending && removeFile.variables === f.id}
                          onClick={() => removeFile.mutate(f.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                  {files.length < a.fileRules.maxFiles && sub.timing.accepting && (
                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-control)] border border-dashed border-border-strong px-3 py-4 text-sm text-fg-muted hover:bg-surface-2 focus-within:outline-2 focus-within:outline-ring">
                      <Upload className="h-4 w-4" aria-hidden />
                      {uploadProgress != null
                        ? `Uploading ${Math.round(uploadProgress * 100)}%`
                        : `Add a file (${a.fileRules.allowedExtensions.join(', ')}; max ${a.fileRules.maxFileSizeMb} MB)`}
                      <input
                        type="file"
                        className="sr-only"
                        accept={a.fileRules.allowedExtensions.map((e) => `.${e}`).join(',')}
                        disabled={uploadProgress != null}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (file) void uploadFile(file);
                        }}
                      />
                    </label>
                  )}
                </div>
              )}
              <p className="text-xs text-fg-muted" aria-live="polite">
                {saveState === 'saving' && 'Saving draft…'}
                {saveState === 'saved' &&
                  sub.draft.savedAt &&
                  `Draft saved ${formatRelative(sub.draft.savedAt)}. A draft is not a submission.`}
                {saveState === 'error' && !conflict && (
                  <>
                    Draft not saved.{' '}
                    <Button
                      variant="link"
                      className="text-xs"
                      onClick={() =>
                        save.mutate({
                          text: a.submissionMethods.text ? text : undefined,
                          url: a.submissionMethods.url ? url.trim() : undefined,
                        })
                      }
                    >
                      Retry
                    </Button>
                  </>
                )}
                {saveState === 'idle' && dirty && 'Unsaved changes'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={!sub.canSubmit || busy || dirty || conflict || !hasContent}
                  onClick={() => {
                    idempotencyKey.current = newIdempotencyKey();
                    setConfirmOpen(true);
                  }}
                >
                  {sub.attemptCount > 0 ? 'Submit new attempt' : 'Submit'}
                </Button>
                {sub.canWithdraw && (
                  <Button variant="secondary" onClick={() => setWithdrawOpen(true)}>
                    Withdraw submission
                  </Button>
                )}
              </div>
              {!sub.canSubmit && sub.submitBlockedMessage && (
                <p className="text-sm text-fg-muted">{sub.submitBlockedMessage}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-fg-muted">
              This work has been graded. Your instructor can return it if a revision is needed.
            </p>
          )}

          {sub.currentVersion && (
            <div className="rounded-[var(--radius-control)] bg-surface-2 px-3 py-2 text-sm">
              Last submitted {formatDateTime(sub.currentVersion.submittedAt)} (attempt{' '}
              {sub.currentVersion.attemptNumber}
              {sub.currentVersion.isLate ? ', late' : ''}). Receipt{' '}
              <span className="font-mono">{sub.currentVersion.receiptCode}</span>.
            </div>
          )}
        </CardBody>
      </Card>

      {sub.attemptCount > 0 && <VersionHistory assignmentId={a.id} />}
      {a.extensionsAllowed && sub.state !== 'graded' && <ExtensionCard a={a} />}

      <Dialog
        open={confirmOpen}
        onOpenChange={(o) => !submit.isPending && setConfirmOpen(o)}
        title="Submit your work?"
        description={
          a.resubmission.allowed
            ? 'You can submit again before the deadline if your attempts allow it.'
            : 'This assignment accepts one submission.'
        }
        footer={
          <>
            <Button variant="secondary" disabled={submit.isPending} onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button loading={submit.isPending} onClick={() => submit.mutate()}>
              {submit.error instanceof ApiError && submit.error.isNetwork ? 'Retry submission' : 'Submit'}
            </Button>
          </>
        }
      >
        <ul className="space-y-1 text-sm">
          {a.submissionMethods.text && text.trim() && (
            <li className="flex items-center gap-2">
              <FileText className="h-4 w-4" aria-hidden /> Written response ({text.trim().split(/\s+/).length}{' '}
              words)
            </li>
          )}
          {a.submissionMethods.url && url.trim() && (
            <li className="flex items-center gap-2">
              <Link2 className="h-4 w-4" aria-hidden /> {url.trim()}
            </li>
          )}
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2">
              <Paperclip className="h-4 w-4" aria-hidden /> {f.name}
            </li>
          ))}
        </ul>
        {sub.timing.wouldBeLate && (
          <Alert tone="warning" className="mt-3">
            This submission will be marked late.
          </Alert>
        )}
        {submit.error instanceof ApiError && submit.error.isNetwork && (
          <Alert tone="danger" className="mt-3">
            The connection dropped before we heard back. Retrying is safe: if the first attempt reached the
            server, it will not be submitted twice.
          </Alert>
        )}
      </Dialog>

      <ConfirmDialog
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        title="Withdraw this submission?"
        description="Your instructor will no longer see it as submitted. Your draft stays, and you can submit again before the deadline. Withdrawing does not refund an attempt."
        confirmLabel="Withdraw"
        tone="danger"
        pending={withdraw.isPending}
        onConfirm={() => withdraw.mutate()}
      />

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(o) => !o && blocker.reset?.()}
        title="Leave without saving?"
        description="Your latest changes have not been saved yet."
        confirmLabel="Leave"
        tone="danger"
        onConfirm={() => blocker.proceed?.()}
      />
    </>
  );
}

function VersionHistory({ assignmentId }: { assignmentId: string }) {
  const { api } = useOrg();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['org', api, 'assignments', assignmentId, 'versions'],
    queryFn: () => get<SubmissionVersionDTO[]>(`${api}/assignments/${assignmentId}/my-submission/versions`),
    enabled: open,
  });
  return (
    <Card>
      <CardHeader
        title="Submission history"
        actions={
          <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <History className="h-4 w-4" aria-hidden /> {open ? 'Hide' : 'Show'}
          </Button>
        }
      />
      {open && (
        <CardBody>
          {q.isPending && <SkeletonRows rows={2} />}
          <ol className="space-y-3">
            {q.data?.map((v) => (
              <li key={v.id} className="rounded-[var(--radius-control)] border border-border p-3 text-sm">
                <p className="font-medium">
                  Attempt {v.attemptNumber} · {formatDateTime(v.submittedAt)}{' '}
                  {v.isLate && <Badge tone="warning">Late</Badge>}
                </p>
                <p className="font-mono text-xs text-fg-muted">Receipt {v.receiptCode}</p>
                {v.text && <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-fg-muted">{v.text}</p>}
                {v.url && (
                  <a
                    href={v.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 block text-accent hover:underline"
                  >
                    {v.url}
                  </a>
                )}
                <div className="mt-1">
                  <AttachmentList files={v.files} />
                </div>
              </li>
            ))}
          </ol>
        </CardBody>
      )}
    </Card>
  );
}

function ExtensionCard({ a }: { a: AssignmentDTO }) {
  const { api } = useOrg();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const requests = useQuery({
    queryKey: ['org', api, 'extensions', { assignmentId: a.id }],
    queryFn: () =>
      get<Paginated<ExtensionRequestDTO>>(`${api}/extension-requests`, { assignmentId: a.id, pageSize: 10 }),
  });
  const request = useMutation({
    mutationFn: () =>
      post(`${api}/assignments/${a.id}/extension-requests`, { requestedDueAt: fromLocalInput(date), reason }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['org', api] });
      setOpen(false);
      setDate('');
      setReason('');
      toast.success('Request sent to your instructor.');
    },
    onError: (e) =>
      setError(e instanceof ApiError ? (Object.values(e.fields)[0]?.[0] ?? e.message) : 'Request failed.'),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => post(`${api}/extension-requests/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org', api] }),
  });
  const pending = requests.data?.items.find((r) => r.status === 'pending');
  return (
    <Card>
      <CardHeader title="Extension" />
      <CardBody className="space-y-3 text-sm">
        {requests.data?.items.map((r) => (
          <div key={r.id} className="rounded-[var(--radius-control)] bg-surface-2 px-3 py-2">
            <p>
              <Badge
                tone={
                  r.status === 'approved'
                    ? 'success'
                    : r.status === 'denied'
                      ? 'danger'
                      : r.status === 'pending'
                        ? 'info'
                        : 'neutral'
                }
              >
                {r.status}
              </Badge>{' '}
              {r.status === 'approved' && r.approvedDueAt
                ? `New due date ${formatDateTime(r.approvedDueAt)}`
                : `Requested until ${formatDateTime(r.requestedDueAt)}`}
            </p>
            {r.decisionNote && <p className="mt-1 text-fg-muted">{r.decisionNote}</p>}
            {r.status === 'pending' && (
              <Button
                variant="link"
                className="text-sm"
                loading={cancel.isPending}
                onClick={() => cancel.mutate(r.id)}
              >
                Cancel request
              </Button>
            )}
          </div>
        ))}
        {!pending && (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Request an extension
          </Button>
        )}
      </CardBody>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Request an extension"
        description="Your instructor will approve or decline. Until then, the current due date applies."
        footer={
          <Button
            loading={request.isPending}
            disabled={!date || !reason.trim()}
            onClick={() => request.mutate()}
          >
            Send request
          </Button>
        }
      >
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="New due date and time" required hint="In your time zone.">
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
          <Field label="Reason" required>
            {({ id }) => (
              <Textarea id={id} value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
            )}
          </Field>
        </div>
      </Dialog>
    </Card>
  );
}
