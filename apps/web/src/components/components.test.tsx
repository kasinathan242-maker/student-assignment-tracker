import { rubricIssueMessage } from '../features/rubrics/RubricPages';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type * as ApiModule from '../lib/api';
import { Button } from './ui/button';
import { ErrorState, SubmissionStatusBadge } from './ui/feedback';
import { Field, Input } from './ui/form';
import { ConfirmDialog } from './ui/overlay';
import { AppShell } from './layout/AppShell';
import type { MeDTO } from '@sat/shared';

vi.mock('../lib/api', async (orig) => {
  const actual = await orig<typeof ApiModule>();
  return { ...actual, get: vi.fn(), post: vi.fn() };
});

const api = await import('../lib/api');

function withProviders(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

describe('UI primitives', () => {
  it('Button shows a busy state and blocks duplicate clicks while loading', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Submit
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Submit' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('Field associates label, hint and error with the control', () => {
    render(
      <Field label="Email" hint="Your school address" error="Enter a valid email address">
        {({ id, describedBy, invalid }) => (
          <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} />
        )}
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Your school address Enter a valid email address');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email address');
  });

  it('status badges communicate state in text, not only colour', () => {
    render(<SubmissionStatusBadge status="returned" />);
    expect(screen.getByText('Needs revision')).toBeInTheDocument();
  });

  it('ErrorState hides internals for 404s and offers retry for transient failures', async () => {
    const retry = vi.fn();
    const { rerender } = render(
      <ErrorState error={new ApiError(404, 'not_found', 'Assignment not found.')} onRetry={retry} />,
    );
    expect(screen.getByText(/does not exist or you do not have access/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
    rerender(
      <ErrorState
        error={new ApiError(503, 'database_unavailable', 'Temporarily unavailable', {}, 'req-1')}
        onRetry={retry}
      />,
    );
    expect(screen.getByText('Reference: req-1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(retry).toHaveBeenCalled();
  });

  it('ConfirmDialog requires a reason when asked and passes it on', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Correct grade?"
        confirmLabel="Publish correction"
        requireReason
        onConfirm={onConfirm}
      />,
    );
    const confirm = screen.getByRole('button', { name: 'Publish correction' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/reason/i), 'Rubric item missed');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('Rubric item missed');
  });
});

describe('routing and authentication', () => {
  it('redirects to sign-in when the session is missing', async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(401, 'unauthenticated', 'Sign in'));
    const { RequireAuth } = await import('../app/guards');
    const router = createMemoryRouter(
      [
        { path: '/login', element: <p>Login page</p> },
        { element: <RequireAuth />, children: [{ path: '/private', element: <p>Secret</p> }] },
      ],
      { initialEntries: ['/private'] },
    );
    render(withProviders(<RouterProvider router={router} />));
    await waitFor(() => expect(screen.getByText('Login page')).toBeInTheDocument());
    expect(router.state.location.search).toBe('?next=%2Fprivate');
    expect(screen.queryByText('Secret')).toBeNull();
  });

  it('login form validates client-side and shows server errors without claiming success', async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(401, 'unauthenticated', 'Sign in'));
    vi.mocked(api.post).mockRejectedValue(
      new ApiError(401, 'invalid_credentials', 'Incorrect email or password.'),
    );
    const { LoginPage } = await import('../features/public/AuthPages');
    const router = createMemoryRouter([{ path: '/login/:portal', element: <LoginPage /> }], {
      initialEntries: ['/login/student'],
    });
    render(withProviders(<RouterProvider router={router} />));
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Email'), 'kavya@northfield.test');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong password here');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login/student');
  });

  it('role guard denies pages outside the member’s role', async () => {
    const { RequireRole } = await import('../app/guards');
    const { OrgProvider } = await import('../app/org');
    const membership = {
      id: 'm',
      orgId: 'o1',
      orgName: 'Org',
      orgSlug: 'org',
      orgStatus: 'active' as const,
      orgTimezone: 'UTC',
      role: 'student' as const,
      status: 'active' as const,
      studentNumber: null,
    };
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: (
            <OrgProvider membership={membership}>
              <RequireRole roles={['org_admin']}>
                <p>Admin only</p>
              </RequireRole>
            </OrgProvider>
          ),
        },
      ],
      { initialEntries: ['/'] },
    );
    render(withProviders(<RouterProvider router={router} />));
    expect(screen.getByText('You do not have access')).toBeInTheDocument();
    expect(screen.queryByText('Admin only')).toBeNull();
  });
});

describe('rubric validation messages', () => {
  it('names the criterion and field in plain language', () => {
    expect(rubricIssueMessage({ path: ['criteria', 0, 'title'], message: 'Required' })).toBe(
      'Criterion 1: name is required',
    );
    expect(
      rubricIssueMessage({
        path: ['criteria', 1, 'levels', 2, 'points'],
        message: 'Exceeds criterion maximum',
      }),
    ).toBe('Criterion 2, level 3: points: Exceeds criterion maximum');
    expect(rubricIssueMessage({ path: ['title'], message: 'Required' })).toBe('Rubric name: Required');
    expect(rubricIssueMessage({ path: ['criteria'], message: 'Add at least one criterion' })).toBe(
      'Add at least one criterion',
    );
  });
});

describe('app shell', () => {
  const me: MeDTO = {
    csrfToken: 'x',
    user: {
      id: 'u1',
      email: 'priya@example.test',
      name: 'Prof. Priya Raman',
      emailVerified: true,
      timezone: 'UTC',
      locale: 'en',
      hasAvatar: false,
      platformRole: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    memberships: [
      {
        id: 'm1',
        orgId: 'org1',
        orgName: 'Northfield University',
        orgSlug: 'northfield',
        orgStatus: 'active',
        orgTimezone: 'UTC',
        role: 'teacher',
        status: 'active',
        studentNumber: null,
      },
    ],
  };

  it('shows the organization navigation on organization pages', async () => {
    // Regression: the shell sits above the organization route, so it must resolve the organization from
    // the URL. It used to read a context it could not see, leaving the sidebar empty on every page.
    vi.mocked(api.get).mockResolvedValue({ count: 0 });
    const router = createMemoryRouter(
      [{ path: '*', element: <AppShell me={me}>{<p>Page body</p>}</AppShell> }],
      { initialEntries: ['/o/org1/assignments'] },
    );
    render(withProviders(<RouterProvider router={router} />));
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(nav).toHaveTextContent('Northfield University');
    const assignments = screen.getByRole('link', { name: 'Assignments' });
    expect(assignments).toHaveAttribute('href', '/o/org1/assignments');
    expect(assignments).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Rubrics' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch organization' })).toHaveTextContent(
      'Northfield University',
    );
  });

  it('lists organizations to choose from outside an organization', async () => {
    vi.mocked(api.get).mockResolvedValue({ count: 0 });
    const router = createMemoryRouter(
      [{ path: '*', element: <AppShell me={me}>{<p>Account</p>}</AppShell> }],
      { initialEntries: ['/account/profile'] },
    );
    render(withProviders(<RouterProvider router={router} />));
    const nav = await screen.findByRole('navigation', { name: 'Organizations' });
    expect(nav).toHaveTextContent('Northfield University');
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });
});

describe('logins', () => {
  it('offers the Student, Teacher and HOD / Admin logins and keeps where to go next', async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(401, 'unauthenticated', 'Sign in'));
    const { LoginChooserPage } = await import('../features/public/AuthPages');
    const router = createMemoryRouter([{ path: '/login', element: <LoginChooserPage /> }], {
      initialEntries: ['/login?next=%2Fcalendar'],
    });
    render(withProviders(<RouterProvider router={router} />));
    expect(screen.getByRole('link', { name: /Student login/ })).toHaveAttribute(
      'href',
      '/login/student?next=%2Fcalendar',
    );
    expect(screen.getByRole('link', { name: /Teacher login/ })).toHaveAttribute(
      'href',
      '/login/teacher?next=%2Fcalendar',
    );
    expect(screen.getByRole('link', { name: /HOD \/ Admin login/ })).toHaveAttribute(
      'href',
      '/login/admin?next=%2Fcalendar',
    );
  });

  it('sends the chosen login to the server and shows when the account belongs to another login', async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(401, 'unauthenticated', 'Sign in'));
    vi.mocked(api.post).mockRejectedValue(
      new ApiError(403, 'wrong_portal', 'This account cannot use the Teacher login. Use the Student login.'),
    );
    const { LoginPage } = await import('../features/public/AuthPages');
    const router = createMemoryRouter([{ path: '/login/:portal', element: <LoginPage /> }], {
      initialEntries: ['/login/teacher'],
    });
    render(withProviders(<RouterProvider router={router} />));
    expect(screen.getByRole('heading', { name: 'Teacher login' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Email'), 'kavya@northfield.test');
    await userEvent.type(screen.getByLabelText('Password'), 'a long unique passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/Use the Student login/)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/auth/login', {
      email: 'kavya@northfield.test',
      password: 'a long unique passphrase',
      portal: 'teacher',
    });
  });
});
