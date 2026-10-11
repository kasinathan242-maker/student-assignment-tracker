import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, ExternalLink, RotateCcw } from '../../components/ui/icons';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import {
  computeFinalScore,
  validateGrade,
  type GradeHistoryDTO,
  type TeacherGradeDTO,
  type TeacherSubmissionDTO,
} from '@sat/shared';
import { useOrg } from '../../app/org';
import { Button, ButtonLink } from '../../components/ui/button';
import { Alert, Badge, ErrorState, SkeletonRows, SubmissionStatusBadge } from '../../components/ui/feedback';
import { Field, Input, Select, Textarea } from '../../components/ui/form';
import { Card, CardBody, CardHeader, PageHeader } from '../../components/ui/layout';
import { ConfirmDialog, Dialog } from '../../components/ui/overlay';
import { ApiError, get, post, put } from '../../lib/api';
import { formatDateTime, formatPoints } from '../../lib/format';
import { AttachmentList } from '../assignments/StudentAssignmentView';

export function GradingWorkspacePage() {
  const { submissionId = '' } = useParams();
  const { api } = useOrg();
  const q = useQuery({
    queryKey: ['org', api, 'submissions', submissionId],
    queryFn: () => get<TeacherSubmissionDTO>(`${api}/submissions/${submissionId}`),
    refetchOnWindowFocus: false,
  });
  if (q.isPending) return <SkeletonRows rows={8} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return <Workspace key={`${q.data.id}:${q.data.grade?.rev ?? 0}:${q.data.rev}`} s={q.data} />;
}

function Workspace({ s }: { s: TeacherSubmissionDTO }) {
  const { api, path } = useOrg();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const current = s.grade?.draft ?? s.grade?.published ?? null;
  const [versionIndex, setVersionIndex] = useState(0);
  const [points, setPoints] = useState(current && !s.rubric ? String(current.rawPoints) : '');
  const [scores, setScores] = useState<Record<string, { points: string; comment: string }>>(() =>
    Object.fromEntries(
      (s.rubric ?? []).map((c) => {
        const existing = current?.rubricScores.find((r) => r.criterionId === c.id);
        return [c.id, { points: existing ? String(existing.points) : '', comment: existing?.comment ?? '' }];
      }),
    ),
  );
  const [feedback, setFeedback] = useState(current?.feedback ?? '');
  const [notes, setNotes] = useState(current?.privateNotes ?? '');
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [publishOpen, setPublishOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnFeedback, setReturnFeedback] = useState('');
  const version = s.versions[versionIndex];
  const late = s.versions[0]?.lateByMinutes ?? 0;

  // Live score preview with the same rules the server applies.
  const preview = useMemo(() => {
    const rubricScores = Object.entries(scores).map(([criterionId, v]) => ({
      criterionId,
      points: Number(v.points),
    }));
    const result = validateGrade({
      maxPoints: s.assignment.maxPoints,
      points: points === '' ? null : Number(points),
      rubric: s.rubric,
      rubricScores: s.rubric ? rubricScores : undefined,
    });
    return result.ok
      ? computeFinalScore(result.rawPoints, s.assignment.maxPoints, late, s.assignment.latePolicy)
      : null;
  }, [scores, points, s, late]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['org', api] });
  const saveDraft = useMutation({
    mutationFn: () =>
      put<TeacherGradeDTO>(`${api}/submissions/${s.id}/grade`, {
        points: s.rubric ? undefined : points === '' ? null : Number(points),
        rubricScores: s.rubric
          ? Object.entries(scores).map(([criterionId, v]) => ({
              criterionId,
              points: Number(v.points),
              comment: v.comment || undefined,
            }))
          : undefined,
        feedback,
        privateNotes: notes,
        expectedRev: s.grade?.rev,
      }),
    onSuccess: async () => {
      setDirty(false);
      setErrors({});
      await refresh();
      toast.success('Draft saved. Students cannot see it until you publish.');
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        setErrors(e.fields);
        toast.error(
          e.code === 'stale_revision'
            ? 'Someone else changed this grade. Reload to see the latest.'
            : e.message,
        );
      }
    },
  });
  const publish = useMutation({
    mutationFn: (reason: string) =>
      post<TeacherGradeDTO>(`${api}/submissions/${s.id}/grade/publish`, { reason: reason || undefined }),
    onSuccess: async (g) => {
      setPublishOpen(false);
      await refresh();
      toast.success(
        g.visibleToStudent
          ? 'Grade published and the student notified.'
          : 'Grade published. It is held until you release grades for this assignment.',
      );
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not publish.'),
  });
  const returnWork = useMutation({
    mutationFn: () =>
      post(`${api}/submissions/${s.id}/return`, { feedback: returnFeedback, expectedRev: s.rev }),
    onSuccess: async () => {
      setReturnOpen(false);
      setReturnFeedback('');
      await refresh();
      toast.success('Returned for revision. The student was notified.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not return the work.'),
  });

  // Keyboard navigation between submissions: Alt+Left / Alt+Right.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key === 'ArrowLeft' && s.previousId) navigate(path(`/grading/${s.previousId}`));
      if (e.key === 'ArrowRight' && s.nextId) navigate(path(`/grading/${s.nextId}`));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [s.previousId, s.nextId, navigate, path]);

  const correcting = s.grade?.published != null;
  const gradable = s.state === 'submitted' || s.state === 'graded';

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: s.assignment.courseCode || 'Course', to: path(`/courses/${s.assignment.courseId}`) },
          { label: s.assignment.title, to: path(`/assignments/${s.assignment.id}`) },
          { label: 'Submissions', to: path(`/assignments/${s.assignment.id}/submissions`) },
          { label: s.student.name },
        ]}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {s.student.name} <SubmissionStatusBadge status={s.displayStatus} />
          </span>
        }
        description={`${s.student.email}${s.student.studentNumber ? ` · ${s.student.studentNumber}` : ''}${s.extensionDueAt ? ` · extension to ${formatDateTime(s.extensionDueAt)}` : ''}`}
        actions={
          <>
            <ButtonLink
              to={s.previousId ? path(`/grading/${s.previousId}`) : '#'}
              aria-disabled={!s.previousId}
              className={s.previousId ? '' : 'pointer-events-none opacity-50'}
              aria-label="Previous submission (Alt+Left)"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden /> Previous
            </ButtonLink>
            <ButtonLink
              to={s.nextId ? path(`/grading/${s.nextId}`) : '#'}
              aria-disabled={!s.nextId}
              className={s.nextId ? '' : 'pointer-events-none opacity-50'}
              aria-label="Next submission (Alt+Right)"
            >
              Next <ArrowRight className="h-4 w-4" aria-hidden />
            </ButtonLink>
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_28rem]">
        <Card>
          <CardHeader
            title="Submission"
            actions={
              s.versions.length > 1 && (
                <Select
                  aria-label="Attempt"
                  className="h-8 w-48"
                  value={versionIndex}
                  onChange={(e) => setVersionIndex(Number(e.target.value))}
                >
                  {s.versions.map((v, i) => (
                    <option key={v.id} value={i}>
                      Attempt {v.attemptNumber}
                      {i === 0 ? ' (latest)' : ''}
                    </option>
                  ))}
                </Select>
              )
            }
          />
          <CardBody className="space-y-4">
            {version ? (
              <>
                <p className="text-sm text-fg-muted">
                  Attempt {version.attemptNumber}, submitted {formatDateTime(version.submittedAt)}
                  {version.isLate && (
                    <Badge tone="warning" className="ml-2">
                      Late by {Math.ceil(version.lateByMinutes / 60)} h
                    </Badge>
                  )}{' '}
                  · receipt <span className="font-mono">{version.receiptCode}</span>
                </p>
                {version.text && (
                  <div className="rounded-[var(--radius-control)] border border-border bg-surface-2 p-4 text-sm leading-relaxed whitespace-pre-wrap">
                    {version.text}
                  </div>
                )}
                {version.url && (
                  <a
                    href={version.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
                  >
                    <ExternalLink className="h-4 w-4" aria-hidden /> {version.url}
                  </a>
                )}
                <AttachmentList files={version.files} />
              </>
            ) : (
              <p className="text-sm text-fg-muted">No submitted version.</p>
            )}
            {s.returnFeedback && s.state === 'returned' && (
              <Alert tone="warning" title="Returned for revision">
                {s.returnFeedback}
              </Alert>
            )}
          </CardBody>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title={`Grade (out of ${s.assignment.maxPoints})`}
              description={
                s.grade?.hasUnpublishedChanges
                  ? 'You have unpublished changes.'
                  : correcting
                    ? 'Published. Edits create a correction.'
                    : undefined
              }
            />
            <CardBody className="space-y-4">
              {!gradable && (
                <Alert tone="info">
                  This submission was returned for revision. Grade the new attempt when the student resubmits.
                </Alert>
              )}
              {s.rubric ? (
                <fieldset className="space-y-4" disabled={!gradable}>
                  <legend className="sr-only">Rubric scores</legend>
                  {s.rubric.map((c) => (
                    <div key={c.id} className="space-y-1.5">
                      <div className="flex items-end gap-3">
                        <Field
                          label={`${c.title} (max ${c.maxPoints})`}
                          className="flex-1"
                          error={errors[`rubricScores.${c.id}`]}
                        >
                          {({ id, invalid }) =>
                            c.levels.length ? (
                              <Select
                                id={id}
                                aria-invalid={invalid}
                                value={scores[c.id]?.points ?? ''}
                                onChange={(e) => {
                                  setScores((x) => ({
                                    ...x,
                                    [c.id]: { points: e.target.value, comment: x[c.id]?.comment ?? '' },
                                  }));
                                  setDirty(true);
                                }}
                              >
                                <option value="">Choose a level</option>
                                {c.levels.map((l) => (
                                  <option key={l.title} value={l.points}>
                                    {l.title} ({l.points})
                                  </option>
                                ))}
                              </Select>
                            ) : (
                              <Input
                                id={id}
                                type="number"
                                min={0}
                                max={c.maxPoints}
                                step="0.25"
                                aria-invalid={invalid}
                                value={scores[c.id]?.points ?? ''}
                                onChange={(e) => {
                                  setScores((x) => ({
                                    ...x,
                                    [c.id]: { points: e.target.value, comment: x[c.id]?.comment ?? '' },
                                  }));
                                  setDirty(true);
                                }}
                              />
                            )
                          }
                        </Field>
                      </div>
                      <Input
                        aria-label={`Comment on ${c.title}`}
                        placeholder="Comment for the student (optional)"
                        value={scores[c.id]?.comment ?? ''}
                        onChange={(e) => {
                          setScores((x) => ({
                            ...x,
                            [c.id]: { points: x[c.id]?.points ?? '', comment: e.target.value },
                          }));
                          setDirty(true);
                        }}
                      />
                    </div>
                  ))}
                </fieldset>
              ) : (
                <Field label="Points" error={errors.points}>
                  {({ id, invalid }) => (
                    <Input
                      id={id}
                      type="number"
                      min={0}
                      max={s.assignment.maxPoints}
                      step="0.25"
                      className="w-40"
                      disabled={!gradable}
                      aria-invalid={invalid}
                      value={points}
                      onChange={(e) => {
                        setPoints(e.target.value);
                        setDirty(true);
                      }}
                    />
                  )}
                </Field>
              )}
              <div
                className="rounded-[var(--radius-control)] bg-surface-2 px-3 py-2 text-sm"
                aria-live="polite"
              >
                {preview ? (
                  <>
                    Final score{' '}
                    <strong className="tabular">
                      {formatPoints(preview.finalPoints, s.assignment.maxPoints)}
                    </strong>{' '}
                    ({preview.percentage}%)
                    {preview.latePenaltyPoints > 0 && (
                      <span className="text-fg-muted">
                        {' '}
                        after a {preview.latePenaltyPoints}-point late penalty
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-fg-muted">Enter valid scores to see the final grade.</span>
                )}
              </div>
              <Field label="Feedback for the student" error={errors.feedback}>
                {({ id }) => (
                  <Textarea
                    id={id}
                    className="min-h-32"
                    disabled={!gradable}
                    value={feedback}
                    onChange={(e) => {
                      setFeedback(e.target.value);
                      setDirty(true);
                    }}
                  />
                )}
              </Field>
              <Field label="Private notes" hint="Only instructors see these.">
                {({ id, describedBy }) => (
                  <Textarea
                    id={id}
                    className="min-h-16"
                    aria-describedby={describedBy}
                    disabled={!gradable}
                    value={notes}
                    onChange={(e) => {
                      setNotes(e.target.value);
                      setDirty(true);
                    }}
                  />
                )}
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={!gradable || !dirty || !preview}
                  loading={saveDraft.isPending}
                  onClick={() => saveDraft.mutate()}
                >
                  Save draft
                </Button>
                <Button
                  disabled={!gradable || dirty || !s.grade?.hasUnpublishedChanges}
                  onClick={() => setPublishOpen(true)}
                >
                  {correcting ? 'Publish correction' : 'Publish grade'}
                </Button>
                <Button
                  variant="ghost"
                  disabled={s.state !== 'submitted' && s.state !== 'graded'}
                  onClick={() => setReturnOpen(true)}
                >
                  <RotateCcw className="h-4 w-4" aria-hidden /> Return for revision
                </Button>
              </div>
              {dirty && <p className="text-xs text-fg-muted">Save the draft before publishing.</p>}
            </CardBody>
          </Card>
          <GradeHistory submissionId={s.id} />
        </div>
      </div>

      <ConfirmDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title={correcting ? 'Publish a grade correction?' : 'Publish this grade?'}
        description={
          correcting
            ? `The published grade changes from ${formatPoints(s.grade?.published?.finalPoints, s.assignment.maxPoints)} to ${formatPoints(s.grade?.draft?.finalPoints, s.assignment.maxPoints)}. The change and your reason are recorded.`
            : s.assignment.gradeRelease === 'hold'
              ? 'The grade is stored as published but stays hidden until you release grades for the assignment.'
              : 'The student will see the grade and feedback and be notified.'
        }
        confirmLabel={correcting ? 'Publish correction' : 'Publish'}
        requireReason={correcting}
        reasonLabel="Reason for the correction"
        pending={publish.isPending}
        onConfirm={(reason) => publish.mutate(reason)}
      />
      <Dialog
        open={returnOpen}
        onOpenChange={setReturnOpen}
        title="Return for revision"
        description="The student gets one more attempt and sees your note. Any grade stays unpublished for the new attempt until you grade it."
        footer={
          <Button
            loading={returnWork.isPending}
            disabled={!returnFeedback.trim()}
            onClick={() => returnWork.mutate()}
          >
            Return to student
          </Button>
        }
      >
        <Field label="What should the student change?" required>
          {({ id }) => (
            <Textarea
              id={id}
              className="min-h-28"
              value={returnFeedback}
              onChange={(e) => setReturnFeedback(e.target.value)}
            />
          )}
        </Field>
      </Dialog>
    </div>
  );
}

function GradeHistory({ submissionId }: { submissionId: string }) {
  const { api } = useOrg();
  const q = useQuery({
    queryKey: ['org', api, 'submissions', submissionId, 'history'],
    queryFn: () => get<GradeHistoryDTO[]>(`${api}/submissions/${submissionId}/grade-history`),
  });
  if (!q.data || q.data.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Grade history" />
      <CardBody>
        <ol className="space-y-3 text-sm">
          {q.data.map((h) => (
            <li key={h.id}>
              <p className="font-medium">
                {h.action === 'publish'
                  ? `Published ${h.newFinalPoints}`
                  : h.action === 'correct'
                    ? `Corrected ${h.previousFinalPoints} → ${h.newFinalPoints}`
                    : 'Returned for revision'}
              </p>
              <p className="text-fg-muted">
                {h.actor?.name ?? 'Unknown'} · {formatDateTime(h.createdAt)}
              </p>
              {h.reason && <p className="text-fg-muted">“{h.reason}”</p>}
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}
