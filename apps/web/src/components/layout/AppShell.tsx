import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  BookOpen,
  Building2,
  CalendarDays,
  ClipboardList,
  FileClock,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Megaphone,
  Menu as MenuIcon,
  Monitor,
  Moon,
  Network,
  ScrollText,
  Settings,
  ShieldCheck,
  Sun,
  UserCog,
  Users,
  X,
  type IconComponent,
} from '../ui/icons';
import { useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useMatch, useNavigate } from 'react-router';
import type { MeDTO, MembershipSummaryDTO, NotificationDTO, OrgRole, Paginated } from '@sat/shared';
import { get, post } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatRelative, ROLE_LABEL } from '../../lib/format';
import { activeMemberships, rememberOrg, useLogout } from '../../app/session';
import { useTheme, type ThemePreference } from '../../app/theme';
import { Button } from '../ui/button';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '../ui/overlay';

interface NavItem {
  to: string;
  label: string;
  icon: IconComponent;
  end?: boolean;
}

/**
 * The shell wraps every signed-in route, above the organization route that provides the org context, so it
 * resolves the current organization from the URL itself. Reading the org context here left the sidebar
 * navigation and the organization name empty on every page.
 */
function useShellMembership(me: MeDTO): MembershipSummaryDTO | null {
  const match = useMatch('/o/:orgId/*');
  const orgId = match?.params.orgId;
  if (!orgId) return null;
  return activeMemberships(me).find((m) => m.orgId === orgId) ?? null;
}

function orgNav(role: OrgRole, orgId: string): NavItem[] {
  const path = (suffix = '') => `/o/${orgId}${suffix}`;
  if (role === 'student') {
    return [
      { to: path(), label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: path('/assignments'), label: 'Assignments', icon: ClipboardList },
      { to: path('/courses'), label: 'Courses', icon: BookOpen },
      { to: path('/calendar'), label: 'Calendar', icon: CalendarDays },
      { to: path('/announcements'), label: 'Announcements', icon: Megaphone },
      { to: path('/extensions'), label: 'Extension requests', icon: FileClock },
    ];
  }
  const teaching: NavItem[] = [
    { to: path(), label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: path('/courses'), label: 'Courses', icon: BookOpen },
    { to: path('/assignments'), label: 'Assignments', icon: ClipboardList },
    { to: path('/extensions'), label: 'Extension requests', icon: FileClock },
    { to: path('/rubrics'), label: 'Rubrics', icon: ListChecks },
    { to: path('/announcements'), label: 'Announcements', icon: Megaphone },
    { to: path('/calendar'), label: 'Calendar', icon: CalendarDays },
  ];
  if (role === 'teacher') return teaching;
  return [
    ...teaching,
    { to: path('/admin/members'), label: 'Members', icon: Users },
    { to: path('/admin/invitations'), label: 'Invitations', icon: UserCog },
    { to: path('/admin/departments'), label: 'Departments', icon: Network },
    { to: path('/admin/audit'), label: 'Audit log', icon: ScrollText },
    { to: path('/admin/settings'), label: 'Organization settings', icon: Settings },
  ];
}

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium',
                'transition-[background-color,color,box-shadow] duration-200 ease-[var(--ease-out)]',
                isActive
                  ? 'bg-surface text-fg shadow-card ring-1 ring-border/70'
                  : 'text-fg-muted hover:bg-surface/60 hover:text-fg',
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon
                  className={cn(
                    'h-[1.125rem] w-[1.125rem] shrink-0 transition-colors duration-200',
                    isActive ? 'text-accent' : 'text-fg-subtle group-hover:text-fg-muted',
                  )}
                  weight={isActive ? 'fill' : 'regular'}
                  aria-hidden
                />
                {item.label}
              </>
            )}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

function Brand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      to="/"
      className="flex items-center gap-2.5 rounded-xl px-2 py-1 text-[0.9375rem] font-semibold tracking-tight"
      onClick={onNavigate}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-accent text-accent-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_4px_12px_-4px_rgb(10_70_70/0.5)]">
        <GraduationCap className="h-[1.125rem] w-[1.125rem]" weight="fill" aria-hidden />
      </span>
      Assignment Tracker
    </Link>
  );
}

function SidebarContent({
  me,
  membership,
  onNavigate,
}: {
  me: MeDTO;
  membership: MembershipSummaryDTO | null;
  onNavigate?: () => void;
}) {
  const memberships = activeMemberships(me);
  return (
    <div className="flex h-full flex-col gap-7 px-4 py-5">
      <Brand onNavigate={onNavigate} />
      {membership && (
        <nav aria-label="Main">
          <p className="mb-2 truncate px-3 text-xs font-medium text-fg-subtle">{membership.orgName}</p>
          <NavList items={orgNav(membership.role, membership.orgId)} onNavigate={onNavigate} />
        </nav>
      )}
      {!membership && memberships.length > 0 && (
        <nav aria-label="Organizations">
          <p className="mb-2 px-3 text-xs font-medium text-fg-subtle">Your organizations</p>
          <NavList
            onNavigate={onNavigate}
            items={memberships.map((m) => ({
              to: `/o/${m.orgId}`,
              label: m.orgName,
              icon: Building2,
              end: true,
            }))}
          />
        </nav>
      )}
      {me.user.platformRole === 'platform_admin' && (
        <nav aria-label="Platform">
          <p className="mb-2 px-3 text-xs font-medium text-fg-subtle">Platform</p>
          <NavList
            onNavigate={onNavigate}
            items={[
              { to: '/platform', label: 'Organizations', icon: Building2, end: true },
              { to: '/platform/users', label: 'Accounts', icon: Users },
              { to: '/platform/audit', label: 'Platform audit', icon: ScrollText },
              { to: '/platform/health', label: 'Service health', icon: ShieldCheck },
            ]}
          />
        </nav>
      )}
    </div>
  );
}

function OrgSwitcher({ me, membership }: { me: MeDTO; membership: MembershipSummaryDTO | null }) {
  const navigate = useNavigate();
  const memberships = activeMemberships(me);
  if (memberships.length === 0) return null;
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="sm" className="max-w-[18rem] text-fg" aria-label="Switch organization">
          <Building2 className="h-4 w-4 text-fg-subtle" aria-hidden />
          <span className="truncate">{membership?.orgName ?? 'Choose organization'}</span>
          {membership && (
            <span className="hidden rounded-[var(--radius-badge)] bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-fg-muted sm:inline">
              {ROLE_LABEL[membership.role]}
            </span>
          )}
        </Button>
      </MenuTrigger>
      <MenuContent align="start">
        <MenuLabel>Your organizations</MenuLabel>
        {memberships.map((m) => (
          <MenuItem
            key={m.orgId}
            onSelect={() => {
              rememberOrg(m.orgId);
              navigate(`/o/${m.orgId}`);
            }}
          >
            <span className="flex-1 truncate">{m.orgName}</span>
            <span className="text-xs text-fg-muted">{ROLE_LABEL[m.role]}</span>
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onSelect={() => navigate('/join')}>Join another organization</MenuItem>
      </MenuContent>
    </Menu>
  );
}

function NotificationCenter() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const count = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => get<{ count: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
  });
  const list = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: () => get<Paginated<NotificationDTO>>('/notifications', { pageSize: 8 }),
    enabled: open,
  });
  const markRead = useMutation({
    mutationFn: (id: string) => post(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markAll = useMutation({
    mutationFn: () => post('/notifications/read-all', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = count.data?.count ?? 0;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
          className="relative"
        >
          <Bell className="h-[1.125rem] w-[1.125rem]" aria-hidden />
          {unread > 0 && (
            <span
              className="tabular absolute -top-0.5 -right-0.5 min-w-4.5 rounded-full bg-danger px-1 text-[0.6875rem] leading-4.5 font-semibold text-white ring-2 ring-surface dark:text-[#1d0705]"
              aria-hidden
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={10}
          className="z-50 w-[min(24rem,calc(100vw-1rem))] origin-[var(--radix-popover-content-transform-origin)] animate-menu-in overflow-hidden rounded-[22px] bg-surface shadow-pop ring-1 ring-border/60"
        >
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <h2 className="text-sm font-semibold">Notifications</h2>
            <Button
              variant="link"
              className="text-sm"
              disabled={unread === 0}
              loading={markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              Mark all read
            </Button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto px-2 pb-2">
            {list.isLoading && <p className="px-3 py-6 text-sm text-fg-muted">Loading…</p>}
            {list.data?.items.length === 0 && (
              <p className="px-3 py-6 text-sm text-fg-muted">You are all caught up.</p>
            )}
            <ul className="space-y-0.5">
              {list.data?.items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className="flex w-full gap-3 rounded-2xl px-3 py-3 text-left transition-colors duration-150 hover:bg-surface-2"
                    onClick={() => {
                      if (!n.readAt) markRead.mutate(n.id);
                      setOpen(false);
                      if (n.link) navigate(n.link);
                    }}
                  >
                    <span
                      className={cn(
                        'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                        n.readAt ? 'bg-transparent' : 'bg-accent',
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className={cn('block text-sm', !n.readAt && 'font-semibold')}>
                        {n.title}
                        {!n.readAt && <span className="sr-only"> (unread)</span>}
                      </span>
                      {n.body && <span className="line-clamp-2 block text-sm text-fg-muted">{n.body}</span>}
                      <span className="mt-0.5 block text-xs text-fg-subtle">
                        {formatRelative(n.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="border-t border-border bg-surface-2/50 px-5 py-3">
            <Link
              to="/notifications"
              className="text-sm font-medium text-accent hover:underline"
              onClick={() => setOpen(false)}
            >
              View all notifications
            </Link>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

const THEME_ICON: Record<ThemePreference, IconComponent> = { system: Monitor, light: Sun, dark: Moon };

function UserMenu({ me }: { me: MeDTO }) {
  const navigate = useNavigate();
  const logout = useLogout();
  const [theme, setTheme] = useTheme();
  const initials = me.user.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-xl transition-transform duration-200 ease-[var(--ease-spring)] focus-visible:outline-2 focus-visible:outline-ring active:scale-95"
          aria-label="Account menu"
        >
          {me.user.hasAvatar ? (
            <img
              src={`/api/v1/users/${me.user.id}/avatar`}
              alt=""
              className="h-9 w-9 rounded-xl object-cover ring-1 ring-border"
            />
          ) : (
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-xs font-semibold text-accent-soft-fg ring-1 ring-accent/15"
              aria-hidden
            >
              {initials}
            </span>
          )}
        </button>
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>
          <span className="block text-sm font-semibold text-fg">{me.user.name}</span>
          <span className="block truncate">{me.user.email}</span>
        </MenuLabel>
        <MenuSeparator />
        <MenuItem onSelect={() => navigate('/account/profile')}>Profile</MenuItem>
        <MenuItem onSelect={() => navigate('/account/notifications')}>Notification preferences</MenuItem>
        <MenuItem onSelect={() => navigate('/account/security')}>Security and sessions</MenuItem>
        <MenuItem onSelect={() => navigate('/account/data')}>Download my data</MenuItem>
        <MenuSeparator />
        <MenuLabel>Theme</MenuLabel>
        {(['system', 'light', 'dark'] as const).map((t) => {
          const Icon = THEME_ICON[t];
          return (
            <MenuItem key={t} onSelect={() => setTheme(t)}>
              <Icon className="h-4 w-4" aria-hidden />
              <span className="flex-1 capitalize">{t}</span>
              {theme === t && <span className="text-xs text-fg-muted">Current</span>}
            </MenuItem>
          );
        })}
        <MenuSeparator />
        <MenuItem onSelect={() => logout.mutate()}>
          <LogOut className="h-4 w-4" aria-hidden />
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

export function AppShell({ me, children }: { me: MeDTO; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const membership = useShellMembership(me);
  const { pathname } = useLocation();
  return (
    <div className="min-h-[100dvh] lg:grid lg:grid-cols-[17rem_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-xl focus:bg-surface focus:px-4 focus:py-2 focus:shadow-pop"
      >
        Skip to main content
      </a>
      <aside className="sticky top-0 hidden h-[100dvh] overflow-y-auto lg:block">
        <SidebarContent me={me} membership={membership} />
      </aside>
      <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 animate-overlay-in bg-[rgb(8_20_22/0.42)] backdrop-blur-[6px] lg:hidden" />
          <DialogPrimitive.Content className="fixed inset-y-2 left-2 z-50 w-[18rem] max-w-[85vw] animate-sheet-in overflow-y-auto rounded-[24px] bg-bg shadow-pop ring-1 ring-border/60 lg:hidden">
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Main navigation</DialogPrimitive.Description>
            <DialogPrimitive.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-5 right-3"
                aria-label="Close navigation"
              >
                <X className="h-4 w-4" />
              </Button>
            </DialogPrimitive.Close>
            <SidebarContent me={me} membership={membership} onNavigate={() => setMobileOpen(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-3 z-30 mx-3 mt-3 flex h-14 items-center gap-2 rounded-2xl bg-surface/80 px-2.5 shadow-card ring-1 ring-border/70 backdrop-blur-xl supports-[backdrop-filter]:bg-surface/70 sm:mx-5 sm:px-3 lg:mr-6 lg:ml-0">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            <MenuIcon className="h-5 w-5" />
          </Button>
          <OrgSwitcher me={me} membership={membership} />
          <div className="flex-1" />
          <NotificationCenter />
          <UserMenu me={me} />
        </header>
        <main
          id="main"
          className="mx-auto w-full max-w-[1320px] flex-1 px-4 pt-8 pb-16 sm:px-6 lg:pr-10 lg:pl-4"
        >
          {/* Keyed by path so each page settles in once when you navigate to it. */}
          <div key={pathname} className="animate-enter">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
