import { model, Schema } from 'mongoose';
import {
  DEFAULT_REMINDER_OFFSETS_MINUTES,
  INVITATION_STATUSES,
  LATE_POLICY_MODES,
  LIMITS,
  MEMBERSHIP_STATUSES,
  ORG_ROLES,
  ORG_STATUSES,
  SELF_REGISTRATION_MODES,
  type InvitationStatus,
  type MembershipStatus,
  type OrgRole,
  type OrgSettings,
  type OrgStatus,
} from '@sat/shared';
import { baseOptions, ObjectId, type Id, type Timestamps } from './_common';

/* ───────────── organizations ───────────── */

export interface OrganizationDoc extends Timestamps {
  _id: Id;
  name: string;
  slug: string;
  status: OrgStatus;
  timezone: string;
  settings: OrgSettings;
  branding: { primaryColor: string | null };
  joinCode: string | null;
  createdBy: Id | null;
}

export function defaultOrgSettings(): OrgSettings {
  return {
    selfRegistration: 'disabled',
    allowedEmailDomains: [],
    teachersCanCreateCourses: true,
    csvImportEnabled: true,
    reminderOffsetsMinutes: [...DEFAULT_REMINDER_OFFSETS_MINUTES],
    defaultLatePolicy: 'reject',
    notificationRetentionDays: 180,
    auditRetentionDays: 730,
  };
}

const orgSchema = new Schema<OrganizationDoc>(
  {
    name: { type: String, required: true, trim: true, maxlength: LIMITS.orgName },
    slug: { type: String, required: true, lowercase: true, trim: true, maxlength: LIMITS.slug },
    status: { type: String, enum: ORG_STATUSES, default: 'active' },
    timezone: { type: String, required: true, maxlength: 64 },
    settings: {
      selfRegistration: { type: String, enum: SELF_REGISTRATION_MODES, default: 'disabled' },
      allowedEmailDomains: { type: [String], default: [] },
      teachersCanCreateCourses: { type: Boolean, default: true },
      csvImportEnabled: { type: Boolean, default: true },
      reminderOffsetsMinutes: { type: [Number], default: () => [...DEFAULT_REMINDER_OFFSETS_MINUTES] },
      defaultLatePolicy: { type: String, enum: LATE_POLICY_MODES, default: 'reject' },
      notificationRetentionDays: { type: Number, default: 180 },
      auditRetentionDays: { type: Number, default: 730 },
    },
    branding: { primaryColor: { type: String, default: null } },
    joinCode: { type: String, default: null },
    createdBy: { type: ObjectId, default: null },
  },
  baseOptions<OrganizationDoc>('organizations'),
);
orgSchema.index({ slug: 1 }, { unique: true });
orgSchema.index(
  { joinCode: 1 },
  { unique: true, partialFilterExpression: { joinCode: { $type: 'string' } } },
);

export const Organization = model<OrganizationDoc>('Organization', orgSchema);

/* ───────────── memberships ───────────── */

export interface MembershipDoc extends Timestamps {
  _id: Id;
  orgId: Id;
  userId: Id;
  role: OrgRole;
  status: MembershipStatus;
  studentNumber: string | null;
  departmentId: Id | null;
  joinedAt: Date;
  invitedBy: Id | null;
}

const membershipSchema = new Schema<MembershipDoc>(
  {
    orgId: { type: ObjectId, required: true },
    userId: { type: ObjectId, required: true },
    role: { type: String, enum: ORG_ROLES, required: true },
    status: { type: String, enum: MEMBERSHIP_STATUSES, required: true },
    studentNumber: { type: String, default: null, maxlength: LIMITS.studentNumber },
    departmentId: { type: ObjectId, default: null },
    joinedAt: { type: Date, required: true },
    invitedBy: { type: ObjectId, default: null },
  },
  baseOptions<MembershipDoc>('memberships'),
);
membershipSchema.index({ orgId: 1, userId: 1 }, { unique: true });
membershipSchema.index({ userId: 1, status: 1 });
membershipSchema.index({ orgId: 1, role: 1, status: 1 });
membershipSchema.index(
  { orgId: 1, studentNumber: 1 },
  { unique: true, partialFilterExpression: { studentNumber: { $type: 'string' } } },
);

export const Membership = model<MembershipDoc>('Membership', membershipSchema);

/* ───────────── invitations ───────────── */

export interface InvitationDoc extends Timestamps {
  _id: Id;
  orgId: Id;
  email: string;
  role: OrgRole;
  tokenHash: string;
  status: InvitationStatus;
  courseId: Id | null;
  invitedBy: Id | null;
  expiresAt: Date;
  acceptedBy: Id | null;
  acceptedAt: Date | null;
}

const invitationSchema = new Schema<InvitationDoc>(
  {
    orgId: { type: ObjectId, required: true },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: LIMITS.email },
    role: { type: String, enum: ORG_ROLES, required: true },
    tokenHash: { type: String, required: true },
    status: { type: String, enum: INVITATION_STATUSES, default: 'pending' },
    courseId: { type: ObjectId, default: null },
    invitedBy: { type: ObjectId, default: null },
    expiresAt: { type: Date, required: true },
    acceptedBy: { type: ObjectId, default: null },
    acceptedAt: { type: Date, default: null },
  },
  baseOptions<InvitationDoc>('invitations'),
);
invitationSchema.index({ tokenHash: 1 }, { unique: true });
// At most one pending invitation per email per organization (re-inviting refreshes the token).
invitationSchema.index(
  { orgId: 1, email: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } },
);
invitationSchema.index({ orgId: 1, status: 1, createdAt: -1 });
invitationSchema.index({ email: 1, status: 1 });

export const Invitation = model<InvitationDoc>('Invitation', invitationSchema);

/* ───────────── departments ───────────── */

export interface DepartmentDoc extends Timestamps {
  _id: Id;
  orgId: Id;
  name: string;
  code: string;
  status: 'active' | 'archived';
}

const departmentSchema = new Schema<DepartmentDoc>(
  {
    orgId: { type: ObjectId, required: true },
    name: { type: String, required: true, trim: true, maxlength: LIMITS.departmentName },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: LIMITS.departmentCode },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
  },
  baseOptions<DepartmentDoc>('departments'),
);
departmentSchema.index({ orgId: 1, code: 1 }, { unique: true });

export const Department = model<DepartmentDoc>('Department', departmentSchema);
