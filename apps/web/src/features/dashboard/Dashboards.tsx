import { useQuery } from '@tanstack/react-query';
import { BookOpen, ClipboardList, Inbox, Megaphone } from '../../components/ui/icons';
import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router';
import type {
  AdminDashboardDTO,
  AssignmentListItemDTO,
  StudentDashboardDTO,
  TeacherDashboardDTO,
} from '@sat/shared';
import { useOrg } from '../../app/org';
import { useMe } from '../../app/session';
import { Button, ButtonLink } from '../../components/ui/button';
import { Badge, EmptyState, ErrorState, Skeleton, SubmissionStatusBadge } from '../../components/ui/feedback';
import { Card, CardBody, CardHeader, DateTile, PageHeader, Stat, StatGrid } from '../../components/ui/layout';
import { get } from '../../lib/api';
import {
  dayParts,
  formatPoints,
  formatRelative,
  formatShort,
  greetingName,
  todayLine,
} from '../../lib/format';

const SubmissionsChart = lazy(() => import('./SubmissionsChart'));

export function DashboardPage() {
  const { role } = useOrg();
  if (role === 'student') return <StudentDashboard />;
  if (role === 'teacher') return <TeacherDashboard />;
  return <AdminDashboard />;
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading dashboard">
      <Skeleton className="h-9 w-80 rounded-xl" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-[20px]" />
        <Skeleton className="h-72 rounded-[20px]" />
      </div>
    </div>
  );
}

function Greeting() {
  const me = useMe();
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = greetingName(me.data?.user.name);
  return <>{name ? `${part}, ${name}` : part}</>;
}

function DueList({ items, empty }: { items: AssignmentListItemDTO[]; empty: string }) {
  const { path } = useOrg();
  if (items.length === 0) return <p className="py-4 text-sm text-fg-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {items.map((a) => (
        <li key={a.id} className="flex items-center justify-between gap-3 py-3">
          <DateTile {...dayParts(a.effectiveDueAt)} />
          <div className="min-w-0 flex-1">
            <Link
              to={path(`/assignments/${a.id}`)}
              className="block truncate font-medium hover:text-accent hover:underline"
            >
              {a.title}
            </Link>
            <p className="text-sm text-fg-muted">
              {a.courseCode} · due {formatShort(a.effectiveDueAt)} ({formatRelative(a.effectiveDueAt)})
            </p>
          </div>
          {a.displayStatus && <SubmissionStatusBadge status={a.displayStatus} />}
        </li>
      ))}
    </ul>
  );
}

function StudentDashboard() {
  const { api, path } = useOrg();
  const q = useQuery({
    queryKey: ['org', api, 'dashboard', 'student'],
    queryFn: () => get<StudentDashboardDTO>(`${api}/dashboard/student`),
  });
  if (q.isPending) return <DashboardSkeleton />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  return (
    <div className="space-y-6">
      <PageHeader
        title={<Greeting />}
        description={
          d.activeCourses === 0
            ? todayLine()
            : `${todayLine()}. You are enrolled in ${d.activeCourses} active course${d.activeCourses === 1 ? '' : 's'}.`
        }
      />
      {d.activeCourses === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="You are not enrolled in any courses yet"
          description="Your teachers will add you to their courses. Assignments appear here as soon as they are published."
        />
      ) : (
        <>
          <StatGrid>
            <Stat
              label="Due in 7 days"
              value={d.counts.dueSoon}
              to={path('/assignments?bucket=upcoming')}
              emphasis
            />
            <Stat label="To do" value={d.counts.pending} to={path('/assignments?bucket=pending')} />
            <Stat label="Submitted" value={d.counts.submitted} to={path('/assignments?bucket=submitted')} />
            <Stat
              label="Overdue or missing"
              value={d.counts.overdue}
              to={path('/assignments?bucket=overdue')}
            />
            <Stat
              label="Needs revision"
              value={d.counts.returned}
              to={path('/assignments?bucket=returned')}
            />
            <Stat label="Graded" value={d.counts.graded} to={path('/assignments?bucket=graded')} />
          </StatGrid>
          <div className="grid items-start gap-6 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader
                title="Upcoming deadlines"
                actions={
                  <ButtonLink to={path('/calendar')} size="sm" variant="ghost">
                    Calendar
                  </ButtonLink>
                }
              />
              <CardBody className="py-1">
                <DueList items={d.upcoming} empty="Nothing due. Enjoy the break." />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Progress by course" />
              <CardBody>
                <ul className="space-y-4">
                  {d.progressByCourse.map((c) => {
                    const pct = c.total ? Math.round((c.completed / c.total) * 100) : 0;
                    return (
                      <li key={c.courseId}>
                        <div className="flex items-baseline justify-between gap-2 text-sm">
                          <Link to={path(`/courses/${c.courseId}`)} className="font-medium hover:underline">
                            {c.code} <span className="font-normal text-fg-muted">{c.title}</span>
                          </Link>
                          <span className="tabular text-fg-muted">
                            {c.completed}/{c.total} done
                            {c.averagePercent != null ? ` · avg ${c.averagePercent}%` : ''}
                          </span>
                        </div>
                        <div
                          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3"
                          role="img"
                          aria-label={`${pct}% of assignments completed`}
                        >
                          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            </Card>
          </div>
          <div className="grid items-start gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader title="Overdue and missing" />
              <CardBody className="py-1">
                <DueList items={d.overdue} empty="No overdue work." />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Recently graded" />
              <CardBody className="py-1">
                {d.recentlyGraded.length === 0 ? (
                  <p className="py-4 text-sm text-fg-muted">No released grades yet.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {d.recentlyGraded.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                        <Link
                          to={path(`/assignments/${a.id}`)}
                          className="min-w-0 truncate font-medium hover:underline"
                        >
                          {a.title}
                        </Link>
                        <span className="tabular shrink-0 text-sm font-semibold">
                          {formatPoints(a.finalPoints, a.maxPoints)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
            <AnnouncementsCard items={d.announcements} />
          </div>
        </>
      )}
    </div>
  );
}

function AnnouncementsCard({ items }: { items: StudentDashboardDTO['announcements'] }) {
  const { path } = useOrg();
  return (
    <Card>
      <CardHeader
        title="Announcements"
        actions={
          <ButtonLink to={path('/announcements')} size="sm" variant="ghost">
            All
          </ButtonLink>
        }
      />
      <CardBody className="py-1">
        {items.length === 0 ? (
          <p className="py-4 text-sm text-fg-muted">No announcements.</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((a) => (
              <li key={a.id} className="py-2.5">
                <Link to={path(`/announcements/${a.id}`)} className="font-medium hover:underline">
                  {a.title}
                </Link>
                <p className="text-sm text-fg-muted">
                  {a.courseCode ?? 'Organization'} · {formatRelative(a.publishedAt)}
                  {a.requireAck && !a.acknowledgedAt ? ' · acknowledgement needed' : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function TeacherDashboard() {
  const { api, path } = useOrg();
  const q = useQuery({
    queryKey: ['org', api, 'dashboard', 'teacher'],
    queryFn: () => get<TeacherDashboardDTO>(`${api}/dashboard/teacher`),
  });
  if (q.isPending) return <DashboardSkeleton />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  return (
    <div className="space-y-6">
      <PageHeader
        title={<Greeting />}
        description={todayLine()}
        actions={
          d.coursesTaught > 0 && (
            <ButtonLink to={path('/assignments/new')} variant="primary">
              New assignment
            </ButtonLink>
          )
        }
      />
      {d.coursesTaught === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="You are not teaching any courses yet"
          description="Create a course, or ask an administrator to add you as an instructor."
          action={
            <ButtonLink to={path('/courses')} variant="primary">
              Go to courses
            </ButtonLink>
          }
        />
      ) : (
        <>
          <StatGrid>
            <Stat label="Courses" value={d.coursesTaught} to={path('/courses')} />
            <Stat
              label="Active assignments"
              value={d.assignments.active}
              hint={`${d.assignments.scheduled} scheduled, ${d.assignments.draft} drafts`}
              to={path('/assignments')}
            />
            <Stat label="To grade" value={d.pendingGrading} emphasis />
            <Stat label="Late submissions" value={d.lateSubmissions} />
            <Stat label="Missing (30 days)" value={d.missingSubmissions} />
            <Stat label="Extension requests" value={d.pendingExtensions} to={path('/extensions')} />
          </StatGrid>
          <div className="grid items-start gap-6 lg:grid-cols-[1.3fr_1fr]">
            <Card>
              <CardHeader title="Upcoming deadlines" />
              <CardBody className="py-1">
                {d.upcomingDeadlines.length === 0 ? (
                  <p className="py-4 text-sm text-fg-muted">No published assignments are due soon.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {d.upcomingDeadlines.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                        <DateTile {...dayParts(a.dueAt)} />
                        <div className="min-w-0 flex-1">
                          <Link
                            to={path(`/assignments/${a.id}`)}
                            className="block truncate font-medium hover:underline"
                          >
                            {a.title}
                          </Link>
                          <p className="text-sm text-fg-muted">
                            {a.courseCode} · due {formatShort(a.dueAt)}
                          </p>
                        </div>
                        <Link
                          to={path(`/assignments/${a.id}/submissions`)}
                          className="tabular shrink-0 text-sm text-fg-muted hover:text-fg hover:underline"
                        >
                          {a.submitted}/{a.targeted} submitted
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Recent submissions" />
              <CardBody className="py-1">
                {d.recentSubmissions.length === 0 ? (
                  <p className="py-4 text-sm text-fg-muted">No submissions yet.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {d.recentSubmissions.map((s) => (
                      <li key={s.submissionId} className="py-2.5">
                        <Link to={path(`/grading/${s.submissionId}`)} className="font-medium hover:underline">
                          {s.studentName}
                        </Link>
                        <p className="text-sm text-fg-muted">
                          {s.courseCode} · {s.assignmentTitle} · {formatRelative(s.submittedAt)}
                          {s.isLate && (
                            <Badge tone="warning" className="ml-2">
                              Late
                            </Badge>
                          )}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Grade release"
                description="Assignments with unpublished grades or held results."
              />
              <CardBody className="py-1">
                {d.gradeRelease.length === 0 ? (
                  <p className="py-4 text-sm text-fg-muted">Nothing waiting for release.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {d.gradeRelease.map((g) => (
                      <li key={g.assignmentId} className="flex items-center justify-between gap-3 py-2.5">
                        <Link
                          to={path(`/assignments/${g.assignmentId}/submissions`)}
                          className="min-w-0 truncate font-medium hover:underline"
                        >
                          {g.courseCode} · {g.title}
                        </Link>
                        <span className="flex shrink-0 gap-1.5">
                          {g.draftGrades > 0 && <Badge tone="info">{g.draftGrades} unpublished</Badge>}
                          {g.held && <Badge tone="warning">Held</Badge>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader
                title="Course completion"
                description="Submitted work as a share of what was assigned."
              />
              <CardBody>
                <ul className="space-y-3">
                  {d.courseCompletion.map((c) => (
                    <li key={c.courseId} className="flex items-center justify-between gap-3 text-sm">
                      <Link to={path(`/courses/${c.courseId}`)} className="font-medium hover:underline">
                        {c.code} <span className="font-normal text-fg-muted">{c.title}</span>
                      </Link>
                      <span className="tabular text-fg-muted">
                        {c.completionRate == null
                          ? 'No published work'
                          : `${c.completionRate}% across ${c.assignments}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function AdminDashboard() {
  const { api, path } = useOrg();
  const [showTable, setShowTable] = useState(false);
  const q = useQuery({
    queryKey: ['org', api, 'dashboard', 'admin'],
    queryFn: () => get<AdminDashboardDTO>(`${api}/dashboard/admin`),
  });
  if (q.isPending) return <DashboardSkeleton />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization overview"
        description="Aggregate activity only. Individual submissions and grades are not shown here."
        actions={
          <>
            <ButtonLink to={path('/admin/invitations')}>Invite people</ButtonLink>
            <ButtonLink to={path('/courses?scope=all')} variant="primary">
              Courses
            </ButtonLink>
          </>
        }
      />
      <StatGrid>
        <Stat
          label="Active members"
          value={d.members.total}
          hint={`${d.members.students} students, ${d.members.teachers} teachers`}
          to={path('/admin/members')}
        />
        <Stat
          label="Awaiting approval"
          value={d.members.pending}
          to={path('/admin/members?status=pending')}
          emphasis={d.members.pending > 0}
        />
        <Stat label="Active courses" value={d.courses.active} hint={`${d.courses.archived} archived`} />
        <Stat
          label="Published assignments"
          value={d.assignments.published}
          hint={`${d.assignments.scheduled} scheduled`}
        />
        <Stat
          label="Pending invitations"
          value={d.invitations.pending}
          hint={`${d.invitations.expired} expired`}
          to={path('/admin/invitations')}
        />
        <Stat label="Joined in 30 days" value={d.invitations.acceptedLast30Days} />
      </StatGrid>
      <div className="grid items-start gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader
            title="Submissions, last 30 days"
            actions={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowTable((v) => !v)}
                aria-pressed={showTable}
              >
                {showTable ? 'Show chart' : 'Show as table'}
              </Button>
            }
          />
          <CardBody>
            {showTable ? (
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Submissions per day</caption>
                  <thead>
                    <tr className="text-left text-fg-muted">
                      <th scope="col" className="py-1 font-medium">
                        Date
                      </th>
                      <th scope="col" className="py-1 text-right font-medium">
                        Submissions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.submissionsByDay.map((r) => (
                      <tr key={r.date} className="border-t border-border">
                        <td className="py-1">{r.date}</td>
                        <td className="tabular py-1 text-right">{r.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Suspense fallback={<Skeleton className="h-64 w-full" />}>
                <SubmissionsChart data={d.submissionsByDay} />
              </Suspense>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Security indicators" />
          <CardBody>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-fg-muted">Failed sign-ins by members (24 h)</dt>
                <dd className="tabular font-semibold">{d.security.failedLoginsLast24h}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-fg-muted">Accounts temporarily locked</dt>
                <dd className="tabular font-semibold">{d.security.lockedAccounts}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-fg-muted">Administrative record access (30 days)</dt>
                <dd className="tabular font-semibold">{d.security.adminAccessEventsLast30Days}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-fg-muted">Suspended members</dt>
                <dd className="tabular font-semibold">{d.members.suspended}</dd>
              </div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <ButtonLink to={path('/admin/audit')} size="sm">
                <Inbox className="h-4 w-4" aria-hidden /> Audit log
              </ButtonLink>
              <ButtonLink to={path('/announcements')} size="sm">
                <Megaphone className="h-4 w-4" aria-hidden /> Announcements
              </ButtonLink>
              <ButtonLink to={path('/assignments')} size="sm">
                <ClipboardList className="h-4 w-4" aria-hidden /> Assignments
              </ButtonLink>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
