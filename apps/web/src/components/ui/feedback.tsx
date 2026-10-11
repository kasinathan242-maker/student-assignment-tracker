import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw, XCircle, type IconComponent } from './icons';
import type { ReactNode } from 'react';
import type { AssignmentStatus, SubmissionDisplayStatus } from '@sat/shared';
import { ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { STATUS_LABEL } from '../../lib/format';
import { Button } from './button';

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg-muted',
  accent: 'bg-accent-soft text-accent-soft-fg',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--radius-badge)] px-2 py-0.5 text-xs font-medium whitespace-nowrap shadow-[inset_0_0_0_1px_color-mix(in_oklab,currentColor_14%,transparent)]',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const STATUS_TONE: Record<SubmissionDisplayStatus, Tone> = {
  not_started: 'neutral',
  draft: 'info',
  submitted: 'success',
  late: 'warning',
  resubmitted: 'success',
  returned: 'warning',
  graded: 'accent',
  withdrawn: 'neutral',
  overdue: 'danger',
  missing: 'danger',
};

/** Status is always conveyed by text, never by colour alone. */
export function SubmissionStatusBadge({ status }: { status: SubmissionDisplayStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

const ASSIGNMENT_TONE: Record<AssignmentStatus, Tone> = {
  draft: 'neutral',
  scheduled: 'info',
  published: 'success',
  closed: 'warning',
  archived: 'neutral',
};
export function AssignmentStatusBadge({ status }: { status: AssignmentStatus }) {
  return <Badge tone={ASSIGNMENT_TONE[status]}>{status[0]?.toUpperCase() + status.slice(1)}</Badge>;
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'relative overflow-hidden rounded-[var(--radius-control)] bg-surface-2',
        'after:absolute after:inset-0 after:-translate-x-full after:animate-[shimmer_1.6s_var(--ease-out)_infinite]',
        'after:bg-gradient-to-r after:from-transparent after:via-surface-3/80 after:to-transparent',
        className,
      )}
    />
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-fg-muted">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: IconComponent;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-[var(--radius-card)] bg-surface-2/60 px-6 py-12 shadow-[inset_0_0_0_1px_var(--border)] sm:items-center sm:text-center">
      {Icon && (
        <span className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface text-accent shadow-card">
          <Icon className="h-6 w-6" weight="light" aria-hidden />
        </span>
      )}
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      {description && <p className="max-w-[52ch] text-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  title = 'This could not be loaded',
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const message = error instanceof ApiError ? error.message : 'An unexpected error occurred.';
  const notFound = error instanceof ApiError && (error.status === 404 || error.status === 403);
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-[var(--radius-card)] bg-danger-soft/60 px-5 py-6 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--danger)_25%,transparent)]"
    >
      <h3 className="flex items-center gap-2 text-base font-semibold text-danger">
        <XCircle className="h-5 w-5" aria-hidden />
        {notFound ? 'Not available' : title}
      </h3>
      <p className="text-sm text-fg">
        {notFound ? 'This item does not exist or you do not have access to it.' : message}
      </p>
      {error instanceof ApiError && error.requestId && (
        <p className="font-mono text-xs text-fg-muted">Reference: {error.requestId}</p>
      )}
      {onRetry && !notFound && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" aria-hidden /> Try again
        </Button>
      )}
    </div>
  );
}

const ALERT_ICON: Record<'info' | 'success' | 'warning' | 'danger', IconComponent> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
};

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const Icon = ALERT_ICON[tone];
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={cn(
        'flex gap-3 rounded-2xl px-4 py-3 text-sm',
        tones[tone],
        'shadow-[inset_0_0_0_1px_color-mix(in_oklab,currentColor_18%,transparent)]',
        className,
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="space-y-1 text-fg">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}
