import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  BookOpen,
  ClipboardList,
  GraduationCap,
  MailCheck,
  Users,
  type IconComponent,
} from '../../components/ui/icons';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  LIMITS,
  LOGIN_PORTALS,
  emailSchema,
  joinOrganizationSchema,
  loginPortalSchema,
  loginSchema,
  newPasswordSchema,
  passwordIssues,
  type InvitationDTO,
  type InvitationPreviewDTO,
  type LoginPortal,
  type MeDTO,
} from '@sat/shared';
import { Button, ButtonLink } from '../../components/ui/button';
import { Alert, EmptyState, ErrorState, SkeletonRows } from '../../components/ui/feedback';
import { Field, FormError, Input } from '../../components/ui/form';
import { Card, CardBody, CardHeader, PageHeader } from '../../components/ui/layout';
import { ApiError, get, post } from '../../lib/api';
import { applyServerErrors, consumeHashToken } from '../../lib/forms';
import { browserZone, formatDateTime, ROLE_LABEL } from '../../lib/format';
import { safeNextPath } from '../../lib/safeRedirect';
import { homePath, homePathFor, meKey, useMe, useLogout } from '../../app/session';

function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col">
        <header className="px-4 py-6 sm:px-10">
          <Link to="/" className="inline-flex items-center gap-2.5 rounded-xl font-semibold tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-accent text-accent-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]">
              <GraduationCap className="h-[1.125rem] w-[1.125rem]" weight="fill" aria-hidden />
            </span>
            Assignment Tracker
          </Link>
        </header>
        <main className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:pt-14 lg:items-center lg:pt-0">
          <div className="w-full max-w-[27rem] animate-enter">
            <h1 className="text-[1.875rem] leading-tight font-semibold tracking-tight">{title}</h1>
            {description && <p className="mt-2 text-[0.9375rem] text-fg-muted">{description}</p>}
            <div className="bezel mt-8">
              <div className="bezel-core p-6 sm:p-7">{children}</div>
            </div>
            {footer && <div className="mt-5 text-sm text-fg-muted">{footer}</div>}
          </div>
        </main>
      </div>
      {/* Brand panel: the real product, framed (large screens only). */}
      <aside
        aria-hidden
        className="relative m-3 hidden overflow-hidden rounded-[32px] bg-accent lg:flex lg:flex-col lg:justify-between"
      >
        <span className="pointer-events-none absolute -top-40 -right-32 h-[30rem] w-[30rem] rounded-full bg-white/12 blur-3xl" />
        <span className="pointer-events-none absolute -bottom-48 -left-24 h-[26rem] w-[26rem] rounded-full bg-black/10 blur-3xl" />
        <div className="relative px-12 pt-14">
          <p className="max-w-[22ch] text-[2rem] leading-[1.12] font-semibold tracking-[-0.03em] text-accent-fg">
            Every deadline, submission and grade, kept in order.
          </p>
        </div>
        <div className="relative translate-x-12 translate-y-6 pl-0">
          <div className="rounded-tl-[22px] bg-white/10 p-1.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.18)]">
            <img
              src="/images/dashboard-light.jpg"
              width={1440}
              height={900}
              alt=""
              className="block h-auto w-full rounded-tl-[18px] dark:hidden"
            />
            <img
              src="/images/dashboard-dark.jpg"
              width={1440}
              height={900}
              alt=""
              className="hidden h-auto w-full rounded-tl-[18px] dark:block"
            />
          </div>
        </div>
      </aside>
    </div>
  );
}

const confirmable = z
  .object({ password: newPasswordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

function PasswordHint() {
  return <>At least {LIMITS.passwordMin} characters. A short phrase of unrelated words works well.</>;
}

/* ───────────── sign in ───────────── */

/** The three logins. Each admits only accounts with that role; the server enforces it. */
const PORTALS: Record<
  LoginPortal,
  { title: string; label: string; description: string; icon: IconComponent }
> = {
  student: {
    title: 'Student login',
    label: 'student',
    description: 'Your assignments, deadlines, submissions and grades.',
    icon: BookOpen,
  },
  teacher: {
    title: 'Teacher login',
    label: 'teacher',
    description: 'Your courses, assignments, grading and extension requests.',
    icon: ClipboardList,
  },
  admin: {
    title: 'HOD / Admin login',
    label: 'HOD or admin',
    description: 'Members, departments, organization settings and reports.',
    icon: Users,
  },
};

function AuthNotices() {
  const [params] = useSearchParams();
  return (
    <>
      {params.get('reset') && (
        <Alert tone="success" className="mb-4">
          Your password was changed. Sign in with your new password.
        </Alert>
      )}
      {params.get('verified') && (
        <Alert tone="success" className="mb-4">
          Your email is confirmed. You can sign in now.
        </Alert>
      )}
    </>
  );
}

function RegisterLink() {
  return (
    <>
      New here?{' '}
      <Link to="/register" className="font-medium text-accent hover:underline">
        Create an account
      </Link>
    </>
  );
}

/** /login: choose the Student, Teacher or HOD / Admin login (the query string, such as ?next=, is kept). */
export function LoginChooserPage() {
  const [params] = useSearchParams();
  const query = params.toString();
  return (
    <AuthLayout title="Sign in" description="Choose your login." footer={<RegisterLink />}>
      <AuthNotices />
      <ul className="space-y-3">
        {LOGIN_PORTALS.map((portal) => {
          const info = PORTALS[portal];
          return (
            <li key={portal}>
              <Link
                to={query ? `/login/${portal}?${query}` : `/login/${portal}`}
                className="group flex items-center gap-4 rounded-2xl bg-surface-2/60 p-4 ring-1 ring-border/70 transition-[background-color,box-shadow,transform] duration-200 ease-[var(--ease-spring)] hover:bg-surface hover:shadow-card active:scale-[0.99]"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-fg">
                  <info.icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold tracking-tight">{info.title}</span>
                  <span className="block text-sm text-fg-muted">{info.description}</span>
                </span>
                <ArrowRight
                  className="h-4 w-4 shrink-0 text-fg-subtle transition-transform duration-200 group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </AuthLayout>
  );
}

/** /login/student, /login/teacher and /login/admin */
export function LoginPage() {
  const { portal } = useParams();
  const parsed = loginPortalSchema.safeParse(portal);
  if (!parsed.success) return <Navigate to="/login" replace />;
  return <PortalLogin key={parsed.data} portal={parsed.data} />;
}

function PortalLogin({ portal }: { portal: LoginPortal }) {
  const info = PORTALS[portal];
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const form = useForm<z.input<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const login = useMutation({
    mutationFn: (values: z.input<typeof loginSchema>) => post<MeDTO>('/auth/login', { ...values, portal }),
    onSuccess: (me) => {
      qc.clear();
      qc.setQueryData(meKey, me);
      navigate(safeNextPath(params.get('next'), homePathFor(me, portal)), { replace: true });
    },
    onError: (error, values) => {
      if (error instanceof ApiError && error.code === 'email_not_verified') {
        setUnverifiedEmail(values.email);
        setFormError(null);
        return;
      }
      setFormError(applyServerErrors(form, error));
    },
  });
  const resend = useMutation({
    mutationFn: (email: string) => post('/auth/resend-verification', { email }),
    onSuccess: () => toast.success('If the account needs confirming, a new link is on its way.'),
  });
  const query = params.toString();

  return (
    <AuthLayout
      title={info.title}
      description={info.description}
      footer={
        <div className="space-y-1.5">
          <p>
            Not a {info.label}?{' '}
            <Link
              to={query ? `/login?${query}` : '/login'}
              className="font-medium text-accent hover:underline"
            >
              Choose another login
            </Link>
          </p>
          <p>
            <RegisterLink />
          </p>
        </div>
      }
    >
      <AuthNotices />
      {unverifiedEmail && (
        <Alert tone="warning" title="Confirm your email first" className="mb-4">
          <p>We sent a confirmation link to {unverifiedEmail}.</p>
          <Button variant="link" loading={resend.isPending} onClick={() => resend.mutate(unverifiedEmail)}>
            Send a new link
          </Button>
        </Alert>
      )}
      <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => login.mutate(v))}>
        <FormError message={formError} />
        <Field label="Email" error={form.formState.errors.email?.message}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="email"
              autoComplete="username"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...form.register('email')}
            />
          )}
        </Field>
        <Field label="Password" error={form.formState.errors.password?.message}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="password"
              autoComplete="current-password"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...form.register('password')}
            />
          )}
        </Field>
        <div className="flex items-center justify-between">
          <Link to="/forgot-password" className="text-sm font-medium text-accent hover:underline">
            Forgot password?
          </Link>
          <Button type="submit" loading={login.isPending}>
            Sign in
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}

/* ───────────── registration ───────────── */

const registerForm = z
  .object({
    name: z.string().trim().min(1, 'Enter your name').max(LIMITS.name),
    email: emailSchema,
    password: newPasswordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })
  .superRefine((v, ctx) => {
    for (const issue of passwordIssues(v.password, { email: v.email })) {
      if (!passwordIssues(v.password).includes(issue))
        ctx.addIssue({ code: 'custom', path: ['password'], message: issue });
    }
  });
type RegisterValues = z.input<typeof registerForm>;

type RegisterOutcome = { kind: 'check_email' } | { kind: 'signed_in'; me: MeDTO } | { kind: 'not_signed_in' };

export function RegisterPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerForm),
    defaultValues: { name: '', email: '', password: '', confirm: '' },
  });
  const register = useMutation({
    mutationFn: async ({ confirm: _c, ...values }: RegisterValues): Promise<RegisterOutcome> => {
      const result = await post<{ status: string }>('/auth/register', { ...values, timezone: browserZone() });
      if (result.status !== 'account_ready') return { kind: 'check_email' };
      // Email confirmation is switched off: sign in with the details just entered. The server answers the
      // same way for new and existing emails, so a failed sign-in here reveals nothing extra.
      try {
        return {
          kind: 'signed_in',
          me: await post<MeDTO>('/auth/login', { email: values.email, password: values.password }),
        };
      } catch (error) {
        if (error instanceof ApiError && error.code === 'invalid_credentials')
          return { kind: 'not_signed_in' };
        throw error;
      }
    },
    onSuccess: (outcome, values) => {
      if (outcome.kind === 'check_email') {
        setSentTo(values.email);
      } else if (outcome.kind === 'signed_in') {
        qc.clear();
        qc.setQueryData(meKey, outcome.me);
        navigate(homePath(outcome.me), { replace: true });
      } else {
        setFormError(
          'We could not sign you in with these details. If you already have an account, sign in or reset your password.',
        );
      }
    },
    onError: (error) => setFormError(applyServerErrors(form, error)),
  });

  if (sentTo) {
    return (
      <AuthLayout title="Check your email">
        <div className="flex flex-col items-start gap-3">
          <MailCheck className="h-6 w-6 text-accent" aria-hidden />
          <p className="text-sm">
            If <strong>{sentTo}</strong> can be registered, we have sent a link to confirm it. The link
            expires in 24 hours.
          </p>
          <p className="text-sm text-fg-muted">
            After confirming, sign in and join your organization with an invitation or join code.
          </p>
          <ButtonLink to="/login" variant="secondary">
            Go to sign in
          </ButtonLink>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      description="Received an invitation email? Use the link in that email instead, so you join the right organization automatically."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => register.mutate(v))}>
        <FormError message={formError} />
        <Field label="Full name" required error={form.formState.errors.name?.message}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              autoComplete="name"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...form.register('name')}
            />
          )}
        </Field>
        <Field label="Email" required error={form.formState.errors.email?.message}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="email"
              autoComplete="email"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...form.register('email')}
            />
          )}
        </Field>
        <Field
          label="Password"
          required
          hint={<PasswordHint />}
          error={form.formState.errors.password?.message}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...form.register('password')}
            />
          )}
        </Field>
        <Field label="Confirm password" required error={form.formState.errors.confirm?.message}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...form.register('confirm')}
            />
          )}
        </Field>
        <Button type="submit" className="w-full" loading={register.isPending}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}

/* ───────────── email verification ───────────── */

export function VerifyEmailPage() {
  const navigate = useNavigate();
  const [token] = useState(() => consumeHashToken());
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  // The password proves the person confirming the address is the person who created the account.
  const verify = useMutation({
    mutationFn: () => post('/auth/verify-email', { token, password }),
    onSuccess: () => navigate('/login?verified=1', { replace: true }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Verification failed.'),
  });
  if (!token) {
    return (
      <AuthLayout title="Confirm your email">
        <Alert tone="warning">
          This page needs the link from your confirmation email. Open the link from the email again.
        </Alert>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout
      title="Confirm your email"
      description="Enter the password you chose when you created the account to confirm this address."
      footer={
        <>
          Did not create an account? You can ignore the email.{' '}
          <Link to="/forgot-password" className="font-medium text-accent hover:underline">
            Reset password
          </Link>
        </>
      }
    >
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          verify.mutate();
        }}
      >
        <FormError message={error} />
        <Field label="Password">
          {({ id }) => (
            <Input
              id={id}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" className="w-full" loading={verify.isPending} disabled={!password}>
          Confirm email
        </Button>
      </form>
    </AuthLayout>
  );
}

/* ───────────── password reset ───────────── */

export function ForgotPasswordPage() {
  const [done, setDone] = useState(false);
  const form = useForm<{ email: string }>({
    resolver: zodResolver(z.object({ email: emailSchema })),
    defaultValues: { email: '' },
  });
  const [formError, setFormError] = useState<string | null>(null);
  const request = useMutation({
    mutationFn: (values: { email: string }) => post('/auth/forgot-password', values),
    onSuccess: () => setDone(true),
    onError: (e) => setFormError(applyServerErrors(form, e)),
  });
  return (
    <AuthLayout
      title="Reset your password"
      description="Enter your account email and we will send you a link to choose a new password."
    >
      {done ? (
        <div className="space-y-3">
          <Alert tone="success">
            If an account exists for that address, a reset link is on its way. It expires in 30 minutes.
          </Alert>
          <ButtonLink to="/login" variant="secondary">
            Back to sign in
          </ButtonLink>
        </div>
      ) : (
        <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => request.mutate(v))}>
          <FormError message={formError} />
          <Field label="Email" error={form.formState.errors.email?.message}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="email"
                autoComplete="email"
                aria-describedby={describedBy}
                aria-invalid={invalid}
                {...form.register('email')}
              />
            )}
          </Field>
          <Button type="submit" className="w-full" loading={request.isPending}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [token] = useState(() => consumeHashToken());
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof confirmable>>({
    resolver: zodResolver(confirmable),
    defaultValues: { password: '', confirm: '' },
  });
  const reset = useMutation({
    mutationFn: (v: z.input<typeof confirmable>) =>
      post('/auth/reset-password', { token, password: v.password }),
    onSuccess: () => navigate('/login?reset=1', { replace: true }),
    onError: (e) => setFormError(applyServerErrors(form, e)),
  });
  if (!token) {
    return (
      <AuthLayout title="Choose a new password">
        <Alert tone="warning">Open this page from the link in your password reset email.</Alert>
        <ButtonLink to="/forgot-password" variant="secondary" className="mt-3">
          Request a new link
        </ButtonLink>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Choose a new password" description="All other sessions will be signed out.">
      <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => reset.mutate(v))}>
        <FormError message={formError} />
        <Field
          label="New password"
          required
          hint={<PasswordHint />}
          error={form.formState.errors.password?.message}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...form.register('password')}
            />
          )}
        </Field>
        <Field label="Confirm new password" required error={form.formState.errors.confirm?.message}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...form.register('confirm')}
            />
          )}
        </Field>
        <Button type="submit" className="w-full" loading={reset.isPending}>
          Save new password
        </Button>
      </form>
    </AuthLayout>
  );
}

/* ───────────── invitations ───────────── */

const inviteRegister = z
  .object({
    name: z.string().trim().min(1, 'Enter your name').max(LIMITS.name),
    password: newPasswordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export function AcceptInvitePage() {
  const [token] = useState(() => consumeHashToken());
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const logout = useLogout();
  const [formError, setFormError] = useState<string | null>(null);
  const preview = useQuery({
    queryKey: ['invitation-preview', token],
    queryFn: () => post<InvitationPreviewDTO>('/invitations/preview', { token }),
    enabled: Boolean(token),
    retry: false,
    staleTime: Infinity,
  });
  const form = useForm<z.input<typeof inviteRegister>>({
    resolver: zodResolver(inviteRegister),
    defaultValues: { name: '', password: '', confirm: '' },
  });
  const register = useMutation({
    mutationFn: (v: z.input<typeof inviteRegister>) =>
      post<{ me: MeDTO }>('/auth/register', {
        name: v.name,
        email: preview.data?.email,
        password: v.password,
        invitationToken: token,
        timezone: browserZone(),
      }),
    onSuccess: (data) => {
      qc.setQueryData(meKey, data.me);
      navigate(homePath(data.me), { replace: true });
    },
    onError: (e) => setFormError(applyServerErrors(form, e)),
  });
  const accept = useMutation({
    mutationFn: () => post<{ orgId: string }>('/invitations/accept', { token }),
    onSuccess: async (data) => {
      await qc.invalidateQueries({ queryKey: meKey });
      navigate(`/o/${data.orgId}`, { replace: true });
    },
    onError: (e) => setFormError(e instanceof ApiError ? e.message : 'Could not accept the invitation.'),
  });

  if (!token) {
    return (
      <AuthLayout title="Accept invitation">
        <Alert tone="warning">
          Open this page from the link in your invitation email. Already signed in? Pending invitations also
          appear on the join page.
        </Alert>
      </AuthLayout>
    );
  }
  if (preview.isPending)
    return (
      <AuthLayout title="Accept invitation">
        <SkeletonRows rows={3} />
      </AuthLayout>
    );
  if (preview.error) {
    return (
      <AuthLayout title="Accept invitation">
        <Alert tone="danger">
          {preview.error instanceof ApiError ? preview.error.message : 'This invitation could not be loaded.'}
        </Alert>
      </AuthLayout>
    );
  }
  const inv = preview.data;
  const intro = (
    <p className="mb-4 text-sm">
      You are invited to join <strong>{inv.orgName}</strong> as {ROLE_LABEL[inv.role].toLowerCase()}. The
      invitation was sent to <strong>{inv.email}</strong> and expires {formatDateTime(inv.expiresAt)}.
    </p>
  );

  if (me.data) {
    const matches = me.data.user.email === inv.email;
    return (
      <AuthLayout title="Accept invitation">
        {intro}
        <FormError message={formError} />
        {matches ? (
          <Button className="w-full" loading={accept.isPending} onClick={() => accept.mutate()}>
            Join {inv.orgName}
          </Button>
        ) : (
          <div className="space-y-3">
            <Alert tone="warning">
              You are signed in as {me.data.user.email}. Sign out and sign in with {inv.email} to accept.
            </Alert>
            <Button variant="secondary" onClick={() => logout.mutate()}>
              Sign out
            </Button>
          </div>
        )}
      </AuthLayout>
    );
  }

  if (inv.accountExists) {
    return (
      <AuthLayout title="Accept invitation">
        {intro}
        <p className="mb-4 text-sm text-fg-muted">
          You already have an account. Sign in and the invitation will be waiting on the join page.
        </p>
        <ButtonLink to={`/login?next=${encodeURIComponent('/join')}`} variant="primary">
          Sign in to accept
        </ButtonLink>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Create your account">
      {intro}
      <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => register.mutate(v))}>
        <FormError message={formError} />
        <Field label="Email">{({ id }) => <Input id={id} value={inv.email} readOnly disabled />}</Field>
        <Field label="Full name" required error={form.formState.errors.name?.message}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              autoComplete="name"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...form.register('name')}
            />
          )}
        </Field>
        <Field
          label="Password"
          required
          hint={<PasswordHint />}
          error={form.formState.errors.password?.message}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...form.register('password')}
            />
          )}
        </Field>
        <Field label="Confirm password" required error={form.formState.errors.confirm?.message}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...form.register('confirm')}
            />
          )}
        </Field>
        <Button type="submit" className="w-full" loading={register.isPending}>
          Create account and join
        </Button>
      </form>
    </AuthLayout>
  );
}

/** Signed-in users without an organization (or joining another): invitations and join codes. */
export function JoinPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const me = useMe();
  const invitations = useQuery({
    queryKey: ['me', 'invitations'],
    queryFn: () => get<(InvitationDTO & { orgName: string })[]>('/me/invitations'),
  });
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<{ joinCode: string }>({
    resolver: zodResolver(joinOrganizationSchema),
    defaultValues: { joinCode: '' },
  });
  const accept = useMutation({
    mutationFn: (id: string) => post<{ orgId: string }>(`/me/invitations/${id}/accept`),
    onSuccess: async (data) => {
      await qc.invalidateQueries({ queryKey: meKey });
      toast.success('You joined the organization.');
      navigate(`/o/${data.orgId}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not accept the invitation.'),
  });
  const join = useMutation({
    mutationFn: (v: { joinCode: string }) => post<{ orgId: string; status: string }>('/me/join', v),
    onSuccess: async (data) => {
      await qc.invalidateQueries({ queryKey: meKey });
      form.reset();
      if (data.status === 'active') navigate(`/o/${data.orgId}`);
      else toast.success('Request sent. An administrator will review it.');
    },
    onError: (e) => setFormError(applyServerErrors(form, e)),
  });
  const pending = (me.data?.memberships ?? []).filter((m) => m.status === 'pending');

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Join an organization"
        description="Accept an invitation sent to your email address, or enter a join code from your institution."
      />
      <Card>
        <CardHeader title="Invitations" />
        <CardBody>
          {invitations.isPending && <SkeletonRows rows={2} />}
          {invitations.error && (
            <ErrorState error={invitations.error} onRetry={() => void invitations.refetch()} />
          )}
          {invitations.data?.length === 0 && (
            <EmptyState
              title="No pending invitations"
              description={`Invitations sent to ${me.data?.user.email ?? 'your email'} will appear here.`}
            />
          )}
          <ul className="divide-y divide-border">
            {invitations.data?.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">{inv.orgName}</p>
                  <p className="text-sm text-fg-muted">
                    As {ROLE_LABEL[inv.role].toLowerCase()}
                    {inv.invitedBy ? `, invited by ${inv.invitedBy.name}` : ''}. Expires{' '}
                    {formatDateTime(inv.expiresAt)}.
                  </p>
                </div>
                <Button
                  loading={accept.isPending && accept.variables === inv.id}
                  onClick={() => accept.mutate(inv.id)}
                >
                  Accept
                </Button>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Join with a code" />
        <CardBody>
          {pending.length > 0 && (
            <Alert tone="info" className="mb-4">
              Waiting for approval: {pending.map((p) => p.orgName).join(', ')}.
            </Alert>
          )}
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            noValidate
            onSubmit={form.handleSubmit((v) => join.mutate(v))}
          >
            <Field label="Join code" className="flex-1" error={form.formState.errors.joinCode?.message}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  autoComplete="off"
                  className="font-mono uppercase"
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  {...form.register('joinCode')}
                />
              )}
            </Field>
            <Button type="submit" loading={join.isPending}>
              Join
            </Button>
          </form>
          <FormError message={formError} />
        </CardBody>
      </Card>
    </div>
  );
}
