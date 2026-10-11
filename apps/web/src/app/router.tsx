import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, useRouteError } from 'react-router';
import { SkeletonRows } from '../components/ui/feedback';
import { ErrorPage, NotFound } from '../features/public/StatusPages';
import { OrgRoute, PublicOnly, RequireAuth, RequirePlatformAdmin, RequireRole } from './guards';
import { SessionExpiryWatcher, homePath, useMe } from './session';

/** Route-level code splitting: each page loads on demand. */
function page<T extends object>(loader: () => Promise<T>, name: keyof T) {
  const Component = lazy(async () => ({ default: (await loader())[name] as unknown as ComponentType }));
  return (
    <Suspense fallback={<SkeletonRows rows={6} />}>
      <Component />
    </Suspense>
  );
}

const pub = () => import('../features/public/AuthPages');
const landing = () => import('../features/public/Landing');
const dash = () => import('../features/dashboard/Dashboards');
const courses = () => import('../features/courses/CoursePages');
const asg = () => import('../features/assignments/AssignmentPages');
const asgForm = () => import('../features/assignments/AssignmentForm');
const inbox = () => import('../features/assignments/Inbox');
const grading = () => import('../features/grading/GradingWorkspace');
const rubrics = () => import('../features/rubrics/RubricPages');
const ext = () => import('../features/extensions/ExtensionsPage');
const ann = () => import('../features/announcements/AnnouncementPages');
const cal = () => import('../features/calendar/CalendarPage');
const admin = () => import('../features/admin/AdminPages');
const account = () => import('../features/account/AccountPages');
const platform = () => import('../features/platform/PlatformPages');
const dev = () => import('../features/dev/DevMailbox');

function Root() {
  return (
    <>
      <SessionExpiryWatcher />
      <Outlet />
    </>
  );
}

function RouteError() {
  const error = useRouteError();
  return <ErrorPage error={error} />;
}

function Home() {
  const me = useMe();
  if (me.isPending) return null;
  if (me.data) return <Navigate to={homePath(me.data)} replace />;
  return page(landing, 'Landing');
}

const staff = (node: ReactNode) => <RequireRole roles={['teacher', 'org_admin']}>{node}</RequireRole>;
const adminOnly = (node: ReactNode) => <RequireRole roles={['org_admin']}>{node}</RequireRole>;

export const router = createBrowserRouter([
  {
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/login', element: <PublicOnly>{page(pub, 'LoginChooserPage')}</PublicOnly> },
      { path: '/login/:portal', element: <PublicOnly>{page(pub, 'LoginPage')}</PublicOnly> },
      { path: '/register', element: <PublicOnly>{page(pub, 'RegisterPage')}</PublicOnly> },
      { path: '/verify-email', element: page(pub, 'VerifyEmailPage') },
      { path: '/forgot-password', element: page(pub, 'ForgotPasswordPage') },
      { path: '/reset-password', element: page(pub, 'ResetPasswordPage') },
      { path: '/accept-invite', element: page(pub, 'AcceptInvitePage') },
      ...(import.meta.env.DEV ? [{ path: '/dev/mail', element: page(dev, 'DevMailbox') }] : []),
      {
        element: <RequireAuth />,
        children: [
          { path: '/join', element: page(pub, 'JoinPage') },
          { path: '/notifications', element: page(account, 'NotificationsPage') },
          { path: '/account/profile', element: page(account, 'ProfilePage') },
          { path: '/account/notifications', element: page(account, 'NotificationPreferencesPage') },
          { path: '/account/security', element: page(account, 'SecurityPage') },
          { path: '/account/data', element: page(account, 'DataExportPage') },
          {
            path: '/platform',
            element: <RequirePlatformAdmin>{page(platform, 'PlatformOrgsPage')}</RequirePlatformAdmin>,
          },
          {
            path: '/platform/users',
            element: <RequirePlatformAdmin>{page(platform, 'PlatformUsersPage')}</RequirePlatformAdmin>,
          },
          {
            path: '/platform/audit',
            element: <RequirePlatformAdmin>{page(platform, 'PlatformAuditPage')}</RequirePlatformAdmin>,
          },
          {
            path: '/platform/health',
            element: <RequirePlatformAdmin>{page(platform, 'PlatformHealthPage')}</RequirePlatformAdmin>,
          },
          {
            path: '/o/:orgId',
            element: <OrgRoute />,
            children: [
              { index: true, element: page(dash, 'DashboardPage') },
              { path: 'courses', element: page(courses, 'CourseListPage') },
              { path: 'courses/:courseId', element: page(courses, 'CourseDetailPage') },
              { path: 'assignments', element: page(asg, 'AssignmentListPage') },
              { path: 'assignments/new', element: staff(page(asgForm, 'CreateAssignmentPage')) },
              { path: 'assignments/:assignmentId', element: page(asg, 'AssignmentDetailPage') },
              { path: 'assignments/:assignmentId/edit', element: staff(page(asgForm, 'EditAssignmentPage')) },
              { path: 'assignments/:assignmentId/submissions', element: staff(page(inbox, 'InboxPage')) },
              { path: 'assignments/:assignmentId/receipt', element: page(asg, 'ReceiptPage') },
              { path: 'grading/:submissionId', element: staff(page(grading, 'GradingWorkspacePage')) },
              { path: 'rubrics', element: staff(page(rubrics, 'RubricListPage')) },
              { path: 'rubrics/new', element: staff(page(rubrics, 'RubricEditorPage')) },
              { path: 'rubrics/:rubricId', element: staff(page(rubrics, 'RubricEditorPage')) },
              { path: 'extensions', element: page(ext, 'ExtensionsPage') },
              { path: 'announcements', element: page(ann, 'AnnouncementListPage') },
              { path: 'announcements/:announcementId', element: page(ann, 'AnnouncementDetailPage') },
              { path: 'calendar', element: page(cal, 'CalendarPage') },
              { path: 'admin/members', element: adminOnly(page(admin, 'MembersPage')) },
              { path: 'admin/invitations', element: adminOnly(page(admin, 'InvitationsPage')) },
              { path: 'admin/departments', element: adminOnly(page(admin, 'DepartmentsPage')) },
              { path: 'admin/audit', element: adminOnly(page(admin, 'AuditLogPage')) },
              { path: 'admin/settings', element: adminOnly(page(admin, 'OrgSettingsPage')) },
              { path: '*', element: <NotFound /> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
