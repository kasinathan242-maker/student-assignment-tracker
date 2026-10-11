import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { LoginPortal, MeDTO, MembershipSummaryDTO, OrgRole } from '@sat/shared';
import { ApiError, get, onSessionExpired, post } from '../lib/api';
import { setDisplayZone } from '../lib/format';

export const meKey = ['me'] as const;

export function useMe() {
  const query = useQuery({
    queryKey: meKey,
    queryFn: () => get<MeDTO>('/me'),
    retry: (count, error) => error instanceof ApiError && error.isNetwork && count < 2,
    staleTime: 60_000,
  });
  useEffect(() => {
    if (query.data) setDisplayZone(query.data.user.timezone);
  }, [query.data]);
  return query;
}

export function activeMemberships(me: MeDTO | undefined): MembershipSummaryDTO[] {
  return (me?.memberships ?? []).filter((m) => m.status === 'active' && m.orgStatus === 'active');
}

const LAST_ORG = 'sat-last-org';
export function rememberOrg(orgId: string): void {
  try {
    localStorage.setItem(LAST_ORG, orgId);
  } catch {
    /* storage unavailable */
  }
}
export function preferredOrg(me: MeDTO | undefined): MembershipSummaryDTO | undefined {
  const active = activeMemberships(me);
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_ORG);
  } catch {
    /* ignore */
  }
  return active.find((m) => m.orgId === last) ?? active[0];
}

/** Where a signed-in user lands: their organization dashboard, the join page, or platform admin. */
export function homePath(me: MeDTO | undefined): string {
  const org = preferredOrg(me);
  if (org) return `/o/${org.orgId}`;
  if (me?.user.platformRole === 'platform_admin') return '/platform';
  return '/join';
}

const PORTAL_ROLE: Record<LoginPortal, OrgRole> = {
  student: 'student',
  teacher: 'teacher',
  admin: 'org_admin',
};

/** Where a login lands: an organization where the account has that login's role. */
export function homePathFor(me: MeDTO, portal: LoginPortal): string {
  const matching = activeMemberships(me).filter((m) => m.role === PORTAL_ROLE[portal]);
  const preferred = preferredOrg(me);
  const org = matching.find((m) => m.orgId === preferred?.orgId) ?? matching[0];
  if (org) {
    rememberOrg(org.orgId);
    return `/o/${org.orgId}`;
  }
  if (portal === 'admin' && me.user.platformRole === 'platform_admin') return '/platform';
  return homePath(me);
}

export function useLogout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => post('/auth/logout'),
    onSettled: () => {
      // Clear every cached query so nothing from this session is visible to the next user of the browser.
      qc.clear();
      navigate('/login', { replace: true });
    },
  });
}

/** Listens for unrecoverable 401s (refresh failed) and returns the user to sign-in. */
export function SessionExpiryWatcher() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(
    () =>
      onSessionExpired(() => {
        // Anonymous visitors also hit this path (their /me check fails); there is nothing to clear for them.
        // Clearing the cache while /me is still in flight would orphan that query and leave the page blank.
        const hadSession = qc.getQueryData(meKey) != null;
        if (hadSession) {
          // Drop every cached private query, then let /me refetch into an error state for the guards.
          qc.removeQueries({ predicate: (q) => q.queryKey[0] !== meKey[0] });
          void qc.resetQueries({ queryKey: meKey });
          toast.error('Your session has ended. Please sign in again.');
          navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, {
            replace: true,
          });
        }
      }),
    [qc, navigate, location.pathname, location.search],
  );
  return null;
}
