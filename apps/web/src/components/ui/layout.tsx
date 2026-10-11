import * as TabsPrimitive from '@radix-ui/react-tabs';
import { ArrowUpRight, ChevronLeft, ChevronRight } from './icons';
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link } from 'react-router';
import { cn } from '../../lib/cn';
import { Button } from './button';

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: { label: string; to?: string }[];
}) {
  return (
    <header className="mb-8 flex flex-col gap-4">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-[0.8125rem] text-fg-muted">
            {breadcrumbs.map((b, i) => (
              <li key={`${b.label}-${i}`} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
                {b.to ? (
                  <Link
                    to={b.to}
                    className="rounded-[var(--radius-badge)] transition-colors duration-200 hover:text-fg"
                  >
                    {b.label}
                  </Link>
                ) : (
                  <span aria-current="page">{b.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[1.75rem] leading-[1.15] font-semibold tracking-tight md:text-[2rem]">
            {title}
          </h1>
          {description && <p className="mt-2 max-w-[65ch] text-[0.9375rem] text-fg-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Card({
  children,
  className,
  as: As = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article';
}) {
  return (
    <As
      className={cn(
        'min-w-0 rounded-[var(--radius-card)] bg-surface shadow-card ring-1 ring-border/70',
        className,
      )}
    >
      {children}
    </As>
  );
}

export function CardHeader({
  title,
  actions,
  description,
}: {
  title: ReactNode;
  actions?: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-5 pt-2 pb-5', className)}>{children}</div>;
}

/** Metric tile: label, large tabular value, optional context; linked tiles lift and reveal an arrow. */
export function Stat({
  label,
  value,
  hint,
  to,
  emphasis,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  to?: string;
  /** The one metric on a page that asks for action gets the accent surface. */
  emphasis?: boolean;
}) {
  // A <div> groups each dt/dd pair (valid inside <dl>); when linked, a stretched link makes the whole
  // tile clickable without wrapping the definition terms in an anchor.
  return (
    <div
      className={cn(
        'group relative flex min-h-28 flex-col overflow-hidden rounded-2xl px-4 py-4',
        'transition-transform duration-300 ease-[var(--ease-spring)]',
        emphasis
          ? 'bg-accent text-accent-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_14px_30px_-14px_rgb(10_70_70/0.6)]'
          : 'bg-surface shadow-card ring-1 ring-border/70',
        to && 'hover:-translate-y-0.5',
      )}
    >
      {emphasis && (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full bg-white/15 blur-2xl"
        />
      )}
      <dt
        className={cn(
          'relative flex items-start justify-between gap-2 text-[0.8125rem]',
          emphasis ? 'text-accent-fg/85' : 'text-fg-muted',
        )}
      >
        {label}
        {to && (
          <ArrowUpRight
            className={cn(
              'h-4 w-4 shrink-0 opacity-0 transition-[opacity,transform] duration-300 ease-[var(--ease-spring)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100',
              emphasis ? 'text-accent-fg' : 'text-fg-subtle',
            )}
            aria-hidden
          />
        )}
      </dt>
      <dd className="tabular relative mt-auto pt-3 text-[1.875rem] leading-none font-semibold tracking-tight">
        {to ? (
          <Link
            to={to}
            className="after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring"
          >
            {value}
          </Link>
        ) : (
          value
        )}
      </dd>
      {hint && (
        <dd className={cn('relative mt-1.5 text-xs', emphasis ? 'text-accent-fg/85' : 'text-fg-subtle')}>
          {hint}
        </dd>
      )}
    </div>
  );
}

/** Calendar-style tile for a date: month above day, with the full date for screen readers. */
export function DateTile({ month, day, label }: { month: string; day: string; label: string }) {
  return (
    <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-surface-2 leading-none shadow-[inset_0_0_0_1px_var(--border)]">
      <span className="sr-only">{label}</span>
      <span aria-hidden className="text-[0.6875rem] font-medium text-accent">
        {month}
      </span>
      <span aria-hidden className="tabular mt-1 text-base font-semibold">
        {day}
      </span>
    </span>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{children}</dl>;
}

export function Tabs({
  value,
  onValueChange,
  tabs,
  children,
}: {
  value: string;
  onValueChange: (v: string) => void;
  tabs: { value: string; label: ReactNode }[];
  children: ReactNode;
}) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange}>
      <TabsPrimitive.List
        className="mb-6 inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-surface-2 p-1 shadow-[inset_0_0_0_1px_var(--border)]"
        aria-label="Sections"
      >
        {tabs.map((t) => (
          <TabsPrimitive.Trigger
            key={t.value}
            value={t.value}
            className="rounded-full px-4 py-1.5 text-sm font-medium whitespace-nowrap text-fg-muted transition-[background-color,color,box-shadow] duration-200 ease-[var(--ease-out)] hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-card"
          >
            {t.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {children}
    </TabsPrimitive.Root>
  );
}
export const TabPanel = TabsPrimitive.Content;

export function Pagination({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (total === 0) return null;
  return (
    <nav
      aria-label="Pagination"
      className="mt-4 flex items-center justify-between gap-3 text-sm text-fg-muted"
    >
      <span className="tabular">
        Page {page} of {totalPages} · {total} total
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="h-4 w-4" aria-hidden /> Previous
        </Button>
        <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </nav>
  );
}

/** Responsive table wrapper: horizontal scroll on small screens instead of overflowing the page. */
export function Table({ children, caption }: { children: ReactNode; caption?: string }) {
  return (
    // `relative` makes this scroll box the containing block for absolutely positioned content (such as
    // sr-only header labels); without it they escaped the clipping and widened the page on phones.
    <div className="relative overflow-x-auto rounded-[var(--radius-card)] bg-surface shadow-card ring-1 ring-border/70">
      <table className="w-full min-w-[640px] border-collapse text-sm [&_tbody_tr]:transition-colors [&_tbody_tr]:duration-150 [&_tbody_tr:hover]:bg-surface-2/55 [&_tbody_tr:last-child>td]:border-b-0">
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}
export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th
    scope="col"
    className={cn('border-b border-border px-4 py-3 text-left text-xs font-medium text-fg-muted', className)}
  >
    {children}
  </th>
);
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={cn('border-b border-border px-4 py-3 align-middle', className)}>{children}</td>
);

/** Markdown without raw HTML (react-markdown escapes HTML by default; links open safely). */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-content">
      <ReactMarkdown
        components={{
          a: ({ href, children: c }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {c}
            </a>
          ),
          img: ({ alt }) => <span>[image: {alt}]</span>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
