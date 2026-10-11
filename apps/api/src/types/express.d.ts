import type { MembershipDoc, OrganizationDoc, UserDoc } from '../models';

declare global {
  namespace Express {
    interface Request {
      /** Correlation id (incoming `x-request-id` if well-formed, otherwise generated). */
      id: string;
      /** Server receipt time; the authoritative instant for deadline decisions. */
      receivedAt: Date;
      auth?: {
        userId: string;
        sessionId: string;
        user: UserDoc;
      };
      org?: {
        orgId: string;
        org: OrganizationDoc;
        membership: MembershipDoc | null;
        /** True when a platform administrator acts without an org membership. */
        platformOverride: boolean;
      };
    }
  }
}

export {};
