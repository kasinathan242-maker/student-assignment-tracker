import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation, useParams } from 'react-router';
import type { OrgRole } from '@sat/shared';
import { ErrorState, Skeleton } from '../components/ui/feedback';
import { AppShell } from '../components/layout/AppShell';
import { ApiError } from '../lib/api';
import { safeNextPath } from '../lib/safeRedirect';
import { Forbidden, NotFound } from '../features/public/StatusPages';
import { OrgProvider, useOrg } from './org';
import { activeMemberships, rememberOrg, useMe } from './session';

function BootSkeleton() {
  return (
    <div className="min-h-[100dvh] lg:grid lg:grid-cols-[17rem_1fr]" role="status" aria-label="Loading">
      <div className="hidden px-4 py-5 lg:block">
        <Skeleton className="mb-8 h-8 w-44 rounded-xl" />
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="mb-2 h-9 w-full rounded-xl" />
        ))}
      </div>
      <div className="px-4 pt-3 sm:px-6 lg:pr-10 lg:pl-0">
        <Skeleton className="mb-10 h-14 w-full rounded-2xl" />
        <Skeleton className="mb-6 h-9 w-72 rounded-xl" />
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-72 w-full rounded-[20px]" />
      </div>
    </div>
  );
}

/** Requires a session. UI guards are a convenience only: the API enforces every permission. */
export function RequireAuth() {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <BootSkeleton />;
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      return (
        <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
      );
    }
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorState error={me.error} onRetry={() => void me.refetch()} />
      </div>
    );
  }
  return (
    <AppShell me={me.data}>
      <Outlet />
    </AppShell>
  );
}

/** Resolves `:orgId` against the user's active memberships and provides the organization context. */
export function OrgRoute() {
  const { orgId } = useParams();
  const me = useMe();
  const membership = activeMemberships(me.data).find((m) => m.orgId === orgId);
  if (!membership) return <NotFound />;
  rememberOrg(membership.orgId);
  return (
    <OrgProvider membership={membership}>
      <Outlet />
    </OrgProvider>
  );
}

export function RequireRole({ roles, children }: { roles: OrgRole[]; children: ReactNode }) {
  const { role } = useOrg();
  if (!roles.includes(role)) return <Forbidden />;
  return <>{children}</>;
}

export function RequirePlatformAdmin({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.data?.user.platformRole !== 'platform_admin') return <NotFound />;
  return <>{children}</>;
}

/** For public auth pages: signed-in users are sent to their home instead. */
export function PublicOnly({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return null;
  if (me.data) {
    const next = new URLSearchParams(location.search).get('next');
    return <Navigate to={safeNextPath(next)} replace />;
  }
  return <>{children}</>;
}
