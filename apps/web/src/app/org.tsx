import { createContext, useContext, type ReactNode } from 'react';
import type { MembershipSummaryDTO, OrgRole } from '@sat/shared';

export interface OrgContextValue {
  orgId: string;
  membership: MembershipSummaryDTO;
  role: OrgRole;
  /** Prefix for org-scoped API paths and app routes. */
  api: string;
  path: (suffix?: string) => string;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({
  membership,
  children,
}: {
  membership: MembershipSummaryDTO;
  children: ReactNode;
}) {
  const value: OrgContextValue = {
    orgId: membership.orgId,
    membership,
    role: membership.role,
    api: `/orgs/${membership.orgId}`,
    path: (suffix = '') => `/o/${membership.orgId}${suffix}`,
  };
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used inside an organization route');
  return ctx;
}
