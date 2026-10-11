import type { Router } from 'express';
import { env } from '../config/env';
import { announcementRoutes } from './announcements/routes';
import { assignmentRoutes } from './assignments/routes';
import { auditRoutes } from './audit/routes';
import { authRoutes } from './auth/routes';
import { calendarRoutes } from './calendar/routes';
import { courseRoutes } from './courses/routes';
import { dashboardRoutes } from './dashboards/routes';
import { devRoutes } from './dev/routes';
import { extensionRoutes } from './extensions/routes';
import { fileRoutes } from './files/routes';
import { gradingRoutes } from './grading/routes';
import { healthRoutes } from './health/routes';
import { meRoutes } from './me/routes';
import { notificationRoutes } from './notifications/routes';
import { orgRoutes } from './orgs/routes';
import { platformRoutes } from './platform/routes';
import { submissionRoutes } from './submissions/routes';

export function moduleRouters(): Router[] {
  const routers = [
    healthRoutes(),
    authRoutes(),
    meRoutes(),
    notificationRoutes(),
    fileRoutes(),
    orgRoutes(),
    courseRoutes(),
    assignmentRoutes(),
    submissionRoutes(),
    gradingRoutes(),
    extensionRoutes(),
    announcementRoutes(),
    calendarRoutes(),
    dashboardRoutes(),
    auditRoutes(),
    platformRoutes(),
  ];
  const config = env();
  if (config.DEV_MAILBOX_ENABLED && !config.isProduction) routers.push(devRoutes());
  return routers;
}
