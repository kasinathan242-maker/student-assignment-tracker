import type { ReactNode } from 'react';
import { Link } from 'react-router';
import {
  ArrowUpRight,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Fingerprint,
  GraduationCap,
  History,
  LockKeyhole,
  Send,
  Users,
  type IconComponent,
} from '../../components/ui/icons';
import { ButtonLink } from '../../components/ui/button';
import { cn } from '../../lib/cn';
import { useReveal } from '../../lib/useReveal';

/* ───────────── building blocks ───────────── */

/** Scroll-revealed block; `i` staggers siblings. */
function Reveal({ children, className, i = 0 }: { children: ReactNode; className?: string; i?: number }) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={cn('reveal', className)} style={{ ['--i' as string]: i }}>
      {children}
    </div>
  );
}

/** Real screenshots of the app (captured from the seeded demo), one per theme. */
const SHOTS = {
  dashboard: { width: 1440, height: 900 },
  student: { width: 1128, height: 660 },
  grading: { width: 1128, height: 660 },
  'grade-card': { width: 416, height: 516 },
} as const;
type ShotName = keyof typeof SHOTS;

/** A real screenshot of the app, with the matching image for the active theme. */
function ProductShot({
  name,
  alt,
  className,
  priority,
}: {
  name: ShotName;
  alt: string;
  className?: string;
  priority?: boolean;
}) {
  const common = {
    ...SHOTS[name],
    decoding: 'async' as const,
    loading: priority ? ('eager' as const) : ('lazy' as const),
    fetchPriority: priority ? ('high' as const) : ('auto' as const),
  };
  return (
    <>
      <img {...common} src={`/images/${name}-light.jpg`} alt={alt} className={cn(className, 'dark:hidden')} />
      <img
        {...common}
        src={`/images/${name}-dark.jpg`}
        alt={alt}
        className={cn(className, 'hidden dark:block')}
      />
    </>
  );
}

/** Primary call to action: a pill with its arrow nested in its own circle. */
function PrimaryCta({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className={cn(
        'group inline-flex items-center gap-3 rounded-full bg-accent py-1.5 pr-1.5 pl-6 text-[0.9375rem] font-medium text-accent-fg',
        'shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_10px_30px_-10px_rgb(10_70_70/0.6)]',
        'transition-[background-color,transform] duration-300 ease-[var(--ease-spring)] hover:bg-accent-hover active:scale-[0.98]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
      )}
    >
      {children}
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 transition-transform duration-300 ease-[var(--ease-spring)] group-hover:translate-x-0.5 group-hover:-translate-y-px group-hover:scale-105 dark:bg-black/15">
        <ArrowUpRight className="h-4 w-4" aria-hidden />
      </span>
    </Link>
  );
}

function Brand() {
  return (
    <Link
      to="/"
      className="flex items-center gap-2.5 rounded-xl font-semibold tracking-tight whitespace-nowrap"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-accent text-accent-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]">
        <GraduationCap className="h-[1.125rem] w-[1.125rem]" weight="fill" aria-hidden />
      </span>
      Assignment Tracker
    </Link>
  );
}

/* ───────────── content ───────────── */

const workflow: {
  title: string;
  body: string;
  icon: IconComponent;
  shot?: { name: ShotName; alt: string };
  span: string;
  surface: 'accent' | 'image' | 'pattern';
  /** Settings this step really has, shown as chips on the tiles without a screenshot. */
  chips?: string[];
}[] = [
  {
    title: 'Publish',
    body: 'Publish now or schedule it. Grace periods, late penalties and resubmission limits are enforced for you.',
    icon: Send,
    span: 'lg:col-span-5',
    surface: 'accent',
    chips: [
      'Scheduled publishing',
      'Grace period',
      'Late penalty per day',
      'Attempt limits',
      'Section targeting',
    ],
  },
  {
    title: 'Submit',
    body: 'Drafts save as students work, and every final submission comes with a receipt code.',
    icon: ClipboardList,
    shot: {
      name: 'student',
      alt: 'A student’s assignment page with instructions, deadline and submission status',
    },
    span: 'lg:col-span-7',
    surface: 'image',
  },
  {
    title: 'Grade',
    body: 'Score each criterion of a rubric, leave comments, and move straight to the next student.',
    icon: CheckCircle2,
    shot: { name: 'grading', alt: 'The grading workspace with a submission beside its rubric' },
    span: 'lg:col-span-7',
    surface: 'image',
  },
  {
    title: 'Release',
    body: 'Hold grades until the class is marked, then release them together. Corrections need a written reason.',
    icon: History,
    span: 'lg:col-span-5',
    surface: 'pattern',
    chips: ['Hold until released', 'Release to the class', 'Correction history', 'Reason required'],
  },
];

const roles: { title: string; icon: IconComponent; points: string[] }[] = [
  {
    title: 'Students',
    icon: BookOpen,
    points: [
      'Every assignment and deadline across your courses in one list',
      'Drafts that save as you work, with a receipt for every submission',
      'Grades and feedback the moment they are released',
    ],
  },
  {
    title: 'Teachers',
    icon: ClipboardList,
    points: [
      'Publish now or schedule, with late and resubmission rules enforced for you',
      'A submission inbox that shows who is missing, late or waiting for a grade',
      'Rubric grading, held releases and audited grade corrections',
    ],
  },
  {
    title: 'Administrators',
    icon: Users,
    points: [
      'Invite people, manage roles and keep at least one administrator in charge',
      'Courses, sections and CSV roster imports with a preview before anything changes',
      'An audit log of sensitive actions, searchable and exportable',
    ],
  },
];

const guarantees: { icon: IconComponent; title: string; text: string }[] = [
  {
    icon: CalendarClock,
    title: 'Deadlines you can trust',
    text: 'Server time decides lateness, in each assignment’s time zone, including approved extensions.',
  },
  {
    icon: LockKeyhole,
    title: 'Private by default',
    text: 'Each organization’s data is isolated, and students only ever see their own work.',
  },
  {
    icon: Fingerprint,
    title: 'Accountable changes',
    text: 'Grade corrections keep their history and need a reason. Sensitive actions are audited.',
  },
];

/* ───────────── page ───────────── */

export function Landing() {
  return (
    <div className="min-h-[100dvh] overflow-x-clip">
      {/* Floating navigation island */}
      <header className="fixed inset-x-0 top-4 z-30 px-4">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 rounded-full bg-surface/75 pr-2 pl-4 shadow-card ring-1 ring-border/70 backdrop-blur-xl">
          <Brand />
          <nav aria-label="Sections" className="hidden items-center gap-1 md:flex">
            {[
              ['#workflow', 'Workflow'],
              ['#roles', 'Roles'],
              ['#trust', 'Security'],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="rounded-full px-3.5 py-1.5 text-sm font-medium text-fg-muted transition-colors duration-200 hover:bg-surface-2 hover:text-fg"
              >
                {label}
              </a>
            ))}
          </nav>
          <nav aria-label="Account" className="flex items-center gap-1.5">
            <ButtonLink to="/login" variant="ghost" className="hidden sm:inline-flex">
              Sign in
            </ButtonLink>
            <ButtonLink to="/register" variant="primary" className="h-9 px-4 sm:h-10 sm:px-5">
              Create account
            </ButtonLink>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero: asymmetric split with the real product */}
        <section className="mx-auto grid max-w-6xl items-center gap-16 px-4 pt-32 pb-28 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:gap-12 lg:pt-36">
          <div className="max-w-[40rem]">
            <p
              className="inline-flex animate-enter items-center gap-2 rounded-full bg-surface px-3 py-1 text-xs font-medium text-fg-muted shadow-card ring-1 ring-border/70"
              style={{ animationDelay: '60ms' }}
            >
              <GraduationCap className="h-3.5 w-3.5 text-accent" weight="fill" aria-hidden />
              For schools, colleges and universities
            </p>
            <h1
              className="mt-6 animate-enter text-[2.5rem] leading-[1.06] font-semibold tracking-[-0.035em] sm:text-[3.125rem]"
              style={{ animationDelay: '140ms' }}
            >
              Coursework and feedback, in one place.
            </h1>
            <p
              className="mt-6 max-w-[44ch] animate-enter text-lg leading-relaxed text-fg-muted"
              style={{ animationDelay: '220ms' }}
            >
              Deadlines, submissions and grades for every course. Teachers publish and grade, students submit
              and track their work.
            </p>
            <div
              className="mt-9 flex animate-enter flex-wrap items-center gap-3"
              style={{ animationDelay: '300ms' }}
            >
              <PrimaryCta to="/register">Create account</PrimaryCta>
              <ButtonLink to="/login" className="h-12 px-6 text-[0.9375rem]">
                Sign in
              </ButtonLink>
            </div>
          </div>

          <div className="relative animate-[float-in_1100ms_var(--ease-out)_both] [animation-delay:200ms]">
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-10 -z-10 rounded-full bg-[radial-gradient(closest-side,var(--bg-glow),transparent)] blur-2xl"
            />
            <div className="bezel lg:translate-x-6">
              <div className="bezel-core">
                <ProductShot
                  name="dashboard"
                  alt="A teacher’s dashboard showing work to grade, upcoming deadlines and recent submissions"
                  className="block h-auto w-full"
                  priority
                />
              </div>
            </div>
            <div className="bezel absolute -bottom-16 -left-10 hidden w-[36%] -rotate-3 bg-surface/60 shadow-pop lg:block">
              <div className="bezel-core">
                <ProductShot
                  name="grade-card"
                  alt="A student’s released grade: 23 out of 25 with rubric scores and feedback"
                  className="block h-auto w-full"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Workflow: asymmetric bento */}
        <section
          id="workflow"
          className="mx-auto max-w-6xl scroll-mt-28 px-4 pt-12 pb-24 sm:px-6 lg:pt-16 lg:pb-32"
        >
          <Reveal>
            <h2 className="max-w-[18ch] text-[2.25rem] leading-[1.08] font-semibold tracking-[-0.03em] sm:text-5xl">
              From brief to released grade, in one flow.
            </h2>
          </Reveal>
          <div className="mt-14 grid grid-cols-1 gap-4 lg:grid-cols-12">
            {workflow.map((step, i) => (
              <Reveal key={step.title} i={i % 2} className={cn(step.span)}>
                <article
                  className={cn(
                    'group relative flex h-full min-h-[22rem] flex-col overflow-hidden rounded-[var(--radius-shell)] p-7',
                    step.surface === 'accent' &&
                      'bg-accent text-accent-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_24px_50px_-24px_rgb(10_70_70/0.7)]',
                    step.surface === 'image' && 'bg-surface shadow-card ring-1 ring-border/70',
                    step.surface === 'pattern' && 'bg-surface-2 shadow-[inset_0_0_0_1px_var(--border)]',
                  )}
                >
                  {step.surface === 'accent' && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute -right-20 -bottom-24 h-72 w-72 rounded-full bg-white/12 blur-3xl"
                    />
                  )}
                  {step.surface === 'pattern' && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 opacity-60 [background-image:radial-gradient(var(--border-strong)_1px,transparent_1px)] [background-size:18px_18px] [mask-image:linear-gradient(to_bottom,transparent,black)]"
                    />
                  )}
                  <div className="relative">
                    <span
                      className={cn(
                        'flex h-11 w-11 items-center justify-center rounded-2xl',
                        step.surface === 'accent' ? 'bg-white/15' : 'bg-accent-soft text-accent-soft-fg',
                      )}
                    >
                      <step.icon className="h-5 w-5" weight="light" aria-hidden />
                    </span>
                    <h3 className="mt-6 text-2xl font-semibold tracking-tight">{step.title}</h3>
                    <p
                      className={cn(
                        'mt-2 max-w-[40ch] leading-relaxed',
                        step.surface === 'accent' ? 'text-accent-fg/85' : 'text-fg-muted',
                      )}
                    >
                      {step.body}
                    </p>
                  </div>
                  {step.chips && (
                    <ul
                      className="relative mt-auto flex flex-wrap gap-2 pt-10"
                      aria-label={`${step.title} options`}
                    >
                      {step.chips.map((chip) => (
                        <li
                          key={chip}
                          className={cn(
                            'rounded-full px-3 py-1.5 text-[0.8125rem] font-medium',
                            step.surface === 'accent'
                              ? 'bg-white/12 text-accent-fg shadow-[inset_0_0_0_1px_rgb(255_255_255/0.18)] dark:bg-black/12 dark:shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]'
                              : 'bg-surface text-fg shadow-card ring-1 ring-border/70',
                          )}
                        >
                          {chip}
                        </li>
                      ))}
                    </ul>
                  )}
                  {step.shot && (
                    <div className="relative -mr-7 -mb-7 mt-8 flex-1 overflow-hidden rounded-tl-2xl shadow-[0_0_0_1px_var(--border)]">
                      <ProductShot
                        name={step.shot.name}
                        alt={step.shot.alt}
                        className="h-full min-h-48 w-full object-cover object-left-top transition-transform duration-700 ease-[var(--ease-out)] group-hover:scale-[1.02]"
                      />
                    </div>
                  )}
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Roles: editorial split with a pinned heading */}
        <section id="roles" className="mx-auto max-w-6xl scroll-mt-28 px-4 py-24 sm:px-6 lg:py-32">
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
            <Reveal className="lg:sticky lg:top-32 lg:self-start">
              <h2 className="text-[2.25rem] leading-[1.08] font-semibold tracking-[-0.03em] sm:text-5xl">
                Built around how each role works.
              </h2>
              <p className="mt-5 max-w-[42ch] text-lg leading-relaxed text-fg-muted">
                One account, the right view for what you do in each organization.
              </p>
            </Reveal>
            <div className="space-y-4">
              {roles.map((role, i) => (
                <Reveal key={role.title} i={i}>
                  <div className="bezel">
                    <div className="bezel-core p-7">
                      <h3 className="flex items-center gap-3 text-xl font-semibold tracking-tight">
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-fg">
                          <role.icon className="h-5 w-5" weight="light" aria-hidden />
                        </span>
                        {role.title}
                      </h3>
                      <ul className="mt-5 space-y-3">
                        {role.points.map((p) => (
                          <li key={p} className="flex gap-3 text-[0.9375rem] text-fg-muted">
                            <CheckCircle2
                              className="mt-0.5 h-5 w-5 shrink-0 text-accent"
                              weight="light"
                              aria-hidden
                            />
                            {p}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Trust: one framed statement */}
        <section id="trust" className="mx-auto max-w-6xl scroll-mt-28 px-4 py-24 sm:px-6 lg:py-32">
          <Reveal>
            <div className="bezel">
              <div className="bezel-core relative grid gap-12 p-8 sm:p-12 lg:grid-cols-[1fr_1.2fr] lg:gap-16 lg:p-16">
                <span
                  aria-hidden
                  className="pointer-events-none absolute -top-32 -left-24 h-80 w-80 rounded-full bg-[radial-gradient(closest-side,var(--bg-glow),transparent)] blur-2xl"
                />
                <h2 className="relative text-[2rem] leading-[1.1] font-semibold tracking-[-0.03em] sm:text-[2.5rem]">
                  Records stay private, and changes stay accountable.
                </h2>
                <ul className="relative grid gap-8">
                  {guarantees.map((g) => (
                    <li key={g.title} className="flex gap-4">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-soft-fg">
                        <g.icon className="h-5 w-5" weight="light" aria-hidden />
                      </span>
                      <div>
                        <h3 className="font-semibold tracking-tight">{g.title}</h3>
                        <p className="mt-1 leading-relaxed text-fg-muted">{g.text}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Reveal>
        </section>

        {/* Closing call to action */}
        <section className="mx-auto max-w-6xl px-4 pt-8 pb-28 sm:px-6">
          <Reveal className="flex flex-col items-start gap-8 md:flex-row md:items-end md:justify-between">
            <h2 className="max-w-[16ch] text-[2.25rem] leading-[1.06] font-semibold tracking-[-0.03em] sm:text-5xl">
              Ready when your institution is.
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <PrimaryCta to="/register">Create account</PrimaryCta>
              <ButtonLink to="/login" className="h-12 px-6 text-[0.9375rem]">
                Sign in
              </ButtonLink>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-sm text-fg-muted sm:px-6 md:flex-row md:items-center md:justify-between">
          <Brand />
          <p>Invitation required? Ask your institution’s administrator for an invite link.</p>
          <nav aria-label="Footer" className="flex gap-5">
            <Link to="/login" className="hover:text-fg">
              Sign in
            </Link>
            <Link to="/register" className="hover:text-fg">
              Create account
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
