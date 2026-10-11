import type { RequestHandler } from 'express';
import { errors } from '../lib/errors';
import { isValidId, Membership, Organization, type MembershipDoc, type OrganizationDoc } from '../models';

/**
 * Tenant isolation boundary. Resolves `:orgId` and requires an ACTIVE membership of the caller in that
 * organization. Non-members receive 404 (not 403) so the existence of other tenants is not revealed.
 * Every org-scoped service then filters by `req.org.orgId`.
 */
export const orgContext: RequestHandler = async (req, _res, next) => {
  try {
    const orgId = req.params.orgId;
    if (!isValidId(orgId) || !req.auth) throw errors.notFound('Organization');
    const [org, membership] = await Promise.all([
      Organization.findById(orgId).lean<OrganizationDoc>(),
      Membership.findOne({ orgId, userId: req.auth.userId }).lean<MembershipDoc>(),
    ]);
    if (!org || !membership || membership.status !== 'active') throw errors.notFound('Organization');
    if (org.status !== 'active') {
      throw errors.forbidden('This organization is suspended. Contact your administrator.', 'org_suspended');
    }
    req.org = { orgId: org._id.toString(), org, membership, platformOverride: false };
    next();
  } catch (err) {
    next(err);
  }
};
