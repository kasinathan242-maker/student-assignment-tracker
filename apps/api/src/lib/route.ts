import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { z, type ZodType } from 'zod';
import type { OrgRole } from '@sat/shared';
import { authenticate } from '../middleware/authenticate';
import { orgContext } from '../middleware/orgContext';
import { errors } from './errors';

/**
 * Declarative route definition. Every API route is registered through `route()`, which:
 *  1. applies authentication / tenant (organization) context / role gates in a fixed order,
 *  2. validates params, query and body with Zod (unknown body keys are rejected by `.strict()` schemas),
 *  3. records metadata used to generate the OpenAPI document, so docs cannot drift from the code.
 *
 * Access levels:
 *  - public:   no session required
 *  - user:     signed-in user (any organization)
 *  - org:      signed-in user with an ACTIVE membership in `:orgId` (and optional role allowlist)
 *  - platform: signed-in platform administrator
 */
export type Access = 'public' | 'user' | 'org' | 'platform';
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface HandlerContext<P, Q, B> {
  req: Request;
  res: Response;
  params: P;
  query: Q;
  body: B;
}

export interface RouteDef<P extends ZodType, Q extends ZodType, B extends ZodType> {
  method: Method;
  path: string;
  summary: string;
  tags: string[];
  access: Access;
  orgRoles?: OrgRole[];
  params?: P;
  query?: Q;
  body?: B;
  /** Documentation-only request body type for non-JSON routes. */
  requestContentType?: 'multipart/form-data';
  /** Response content type for documentation (defaults to JSON). */
  responseContentType?: string;
  status?: number;
  middleware?: RequestHandler[];
  description?: string;
  handler: (ctx: HandlerContext<z.output<P>, z.output<Q>, z.output<B>>) => Promise<unknown> | unknown;
}

export interface RegisteredRoute {
  method: Method;
  path: string;
  summary: string;
  description?: string;
  tags: string[];
  access: Access;
  orgRoles?: OrgRole[];
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
  requestContentType?: string;
  responseContentType?: string;
  status: number;
}

export const registry: RegisteredRoute[] = [];

export function zodFieldErrors(error: z.ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_root';
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

function parseOrThrow<T extends ZodType>(schema: T | undefined, value: unknown, where: string): z.output<T> {
  if (!schema) return (where === 'body' ? undefined : {}) as z.output<T>;
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    throw errors.validation(
      'Some fields are invalid. Check the highlighted fields and try again.',
      zodFieldErrors(result.error),
    );
  }
  return result.data;
}

function requireRoles(roles: OrgRole[]): RequestHandler {
  return (req, _res, next) => {
    const role = req.org?.membership?.role;
    if (!role || !roles.includes(role)) return next(errors.forbidden());
    next();
  };
}

const requirePlatformAdmin: RequestHandler = (req, _res, next) => {
  if (req.auth?.user.platformRole !== 'platform_admin') return next(errors.notFound('Resource'));
  next();
};

export function route<P extends ZodType = ZodType, Q extends ZodType = ZodType, B extends ZodType = ZodType>(
  router: Router,
  def: RouteDef<P, Q, B>,
): void {
  const chain: RequestHandler[] = [];
  if (def.access !== 'public') chain.push(authenticate);
  if (def.access === 'org') {
    if (!def.path.includes(':orgId')) throw new Error(`org route without :orgId: ${def.path}`);
    chain.push(orgContext);
    if (def.orgRoles) chain.push(requireRoles(def.orgRoles));
  }
  if (def.access === 'platform') chain.push(requirePlatformAdmin);
  chain.push(...(def.middleware ?? []));

  const status = def.status ?? (def.method === 'post' ? 201 : 200);

  const handler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const params = parseOrThrow(def.params, req.params, 'params');
      const query = parseOrThrow(def.query, req.query, 'query');
      const body = parseOrThrow(def.body, req.body, 'body');
      const result = await def.handler({ req, res, params, query, body });
      if (res.headersSent) return;
      // A handler may choose a different success status (e.g. 202) via res.status().
      const finalStatus = res.statusCode !== 200 ? res.statusCode : status;
      if (result === undefined || finalStatus === 204) {
        res.status(finalStatus === 200 ? 204 : finalStatus).end();
        return;
      }
      res.status(finalStatus).json(result);
    } catch (err) {
      next(err);
    }
  };

  router[def.method](def.path, ...chain, handler);
  registry.push({
    method: def.method,
    path: def.path,
    summary: def.summary,
    description: def.description,
    tags: def.tags,
    access: def.access,
    orgRoles: def.orgRoles,
    params: def.params,
    query: def.query,
    body: def.body,
    requestContentType: def.requestContentType,
    responseContentType: def.responseContentType,
    status,
  });
}

/* Common param schemas */
const oid = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid identifier');
export const P = {
  org: z.object({ orgId: oid }),
  orgCourse: z.object({ orgId: oid, courseId: oid }),
  orgAssignment: z.object({ orgId: oid, assignmentId: oid }),
  orgSubmission: z.object({ orgId: oid, submissionId: oid }),
  id: z.object({ id: oid }),
  orgId: z.object({ orgId: oid, id: oid }),
  orgCourseId: z.object({ orgId: oid, courseId: oid, id: oid }),
  orgAssignmentId: z.object({ orgId: oid, assignmentId: oid, id: oid }),
};
