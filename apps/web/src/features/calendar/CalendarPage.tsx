import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download } from '../../components/ui/icons';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { Link } from 'react-router';
import type { CalendarEventDTO, SubmissionDisplayStatus } from '@sat/shared';
import { useOrg } from '../../app/org';
import { Button } from '../../components/ui/button';
import { Badge, ErrorState, SkeletonRows } from '../../components/ui/feedback';
import { PageHeader } from '../../components/ui/layout';
import { downloadUrl, get } from '../../lib/api';
import { cn } from '../../lib/cn';
import { displayZone, STATUS_LABEL } from '../../lib/format';

const isDisplayStatus = (s: string): s is SubmissionDisplayStatus => s in STATUS_LABEL;

export function CalendarPage() {
  const { api, path } = useOrg();
  const zone = displayZone();
  const [month, setMonth] = useState(() => DateTime.now().setZone(zone).startOf('month'));
  const [view, setView] = useState<'month' | 'list'>(() =>
    window.matchMedia('(max-width: 767px)').matches ? 'list' : 'month',
  );
  const gridStart = month.startOf('week');
  const gridEnd = month.endOf('month').endOf('week');
  const q = useQuery({
    queryKey: ['org', api, 'calendar', month.toISODate()],
    queryFn: () =>
      get<CalendarEventDTO[]>(`${api}/calendar`, {
        from: gridStart.toUTC().toISO(),
        to: gridEnd.toUTC().toISO(),
      }),
    placeholderData: keepPreviousData,
  });
  const byDay = new Map<string, CalendarEventDTO[]>();
  for (const e of q.data ?? []) {
    const key = DateTime.fromISO(e.dueAt).setZone(zone).toISODate() ?? '';
    byDay.set(key, [...(byDay.get(key) ?? []), e]);
  }
  const days: DateTime[] = [];
  for (let d = gridStart; d <= gridEnd; d = d.plus({ days: 1 })) days.push(d);
  const today = DateTime.now().setZone(zone).toISODate();

  const eventLabel = (e: CalendarEventDTO) => (
    <>
      <span className="font-mono text-[0.6875rem]">{e.courseCode}</span> {e.title}
    </>
  );

  return (
    <div>
      <PageHeader
        title="Calendar"
        description={`Deadlines in ${zone}. Extended deadlines show your personal due date.`}
        actions={
          <a
            className="inline-flex h-9.5 items-center gap-2 rounded-[var(--radius-control)] border border-border-strong px-4 text-sm font-medium hover:bg-surface-2"
            href={downloadUrl(`${api}/calendar.ics`)}
          >
            <Download className="h-4 w-4" aria-hidden /> Download .ics
          </a>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="icon"
            aria-label="Previous month"
            onClick={() => setMonth((m) => m.minus({ months: 1 }))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="w-44 text-center text-lg font-semibold" aria-live="polite">
            {month.toFormat('LLLL yyyy')}
          </h2>
          <Button
            variant="secondary"
            size="icon"
            aria-label="Next month"
            onClick={() => setMonth((m) => m.plus({ months: 1 }))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMonth(DateTime.now().setZone(zone).startOf('month'))}
          >
            Today
          </Button>
        </div>
        <div className="flex gap-1.5" role="group" aria-label="View">
          {(['month', 'list'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className="rounded-full border border-border px-3 py-1 text-sm font-medium text-fg-muted capitalize hover:bg-surface-2 aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent-soft-fg"
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      {q.isPending && <SkeletonRows rows={6} />}
      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && view === 'month' && (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[720px] table-fixed border-collapse rounded-[var(--radius-card)] border border-border bg-surface text-sm">
            <caption className="sr-only">Deadlines for {month.toFormat('LLLL yyyy')}</caption>
            <thead>
              <tr>
                {days.slice(0, 7).map((d) => (
                  <th
                    key={d.toISODate()}
                    scope="col"
                    className="border-b border-border px-2 py-1.5 text-left text-xs font-semibold text-fg-muted"
                  >
                    {d.toFormat('ccc')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: days.length / 7 }, (_, w) => (
                <tr key={w}>
                  {days.slice(w * 7, w * 7 + 7).map((d) => {
                    const key = d.toISODate() ?? '';
                    const events = byDay.get(key) ?? [];
                    return (
                      <td
                        key={key}
                        className={cn(
                          'h-28 border border-border p-1.5 align-top',
                          d.month !== month.month && 'bg-surface-2/60 text-fg-subtle',
                        )}
                      >
                        <span
                          className={cn(
                            'tabular inline-flex h-6 w-6 items-center justify-center rounded-full text-xs',
                            key === today && 'bg-accent font-semibold text-accent-fg',
                          )}
                        >
                          {d.day}
                          {key === today && <span className="sr-only"> (today)</span>}
                        </span>
                        <ul className="mt-1 space-y-1">
                          {events.map((e) => (
                            <li key={e.id}>
                              <Link
                                to={path(`/assignments/${e.assignmentId}`)}
                                className="block truncate rounded px-1.5 py-0.5 text-xs bg-accent-soft text-accent-soft-fg hover:underline"
                                title={`${e.title} · ${DateTime.fromISO(e.dueAt).setZone(zone).toFormat('HH:mm')}`}
                              >
                                {eventLabel(e)}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.data && view === 'list' && (
        <div>
          {q.data.filter((e) => DateTime.fromISO(e.dueAt).setZone(zone).hasSame(month, 'month')).length ===
            0 && <p className="text-sm text-fg-muted">No deadlines this month.</p>}
          <ul className="divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
            {q.data
              .filter((e) => DateTime.fromISO(e.dueAt).setZone(zone).hasSame(month, 'month'))
              .map((e) => {
                const due = DateTime.fromISO(e.dueAt).setZone(zone);
                return (
                  <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <Link
                        to={path(`/assignments/${e.assignmentId}`)}
                        className="block truncate font-medium hover:underline"
                      >
                        {e.title}
                      </Link>
                      <p className="text-sm text-fg-muted">
                        {e.courseCode} · {due.toFormat('ccc d LLL, HH:mm')}
                        {e.isExtended && ' · extended'}
                      </p>
                    </div>
                    {isDisplayStatus(e.status) ? (
                      <Badge>{STATUS_LABEL[e.status]}</Badge>
                    ) : (
                      <Badge>{e.status}</Badge>
                    )}
                  </li>
                );
              })}
          </ul>
        </div>
      )}
    </div>
  );
}
