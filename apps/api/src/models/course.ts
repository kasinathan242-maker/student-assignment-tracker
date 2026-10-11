import { model, Schema } from 'mongoose';
import {
  COURSE_STATUSES,
  ENROLLMENT_ROLES,
  ENROLLMENT_STATUSES,
  LIMITS,
  type CourseStatus,
  type EnrollmentRole,
  type EnrollmentStatus,
} from '@sat/shared';
import { baseOptions, ObjectId, type Id, type Timestamps } from './_common';

export interface CourseDoc extends Timestamps {
  _id: Id;
  orgId: Id;
  departmentId: Id | null;
  code: string;
  title: string;
  description: string;
  term: string;
  status: CourseStatus;
  createdBy: Id | null;
  archivedAt: Date | null;
}

const courseSchema = new Schema<CourseDoc>(
  {
    orgId: { type: ObjectId, required: true },
    departmentId: { type: ObjectId, default: null },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: LIMITS.courseCode },
    title: { type: String, required: true, trim: true, maxlength: LIMITS.courseTitle },
    description: { type: String, default: '', maxlength: LIMITS.courseDescription },
    term: { type: String, required: true, trim: true, maxlength: LIMITS.term },
    status: { type: String, enum: COURSE_STATUSES, default: 'active' },
    createdBy: { type: ObjectId, default: null },
    archivedAt: { type: Date, default: null },
  },
  baseOptions<CourseDoc>('courses'),
);
courseSchema.index({ orgId: 1, code: 1, term: 1 }, { unique: true });
courseSchema.index({ orgId: 1, status: 1, code: 1 });
courseSchema.index({ orgId: 1, departmentId: 1 });

export const Course = model<CourseDoc>('Course', courseSchema);

export interface SectionDoc extends Timestamps {
  _id: Id;
  orgId: Id;
  courseId: Id;
  name: string;
  status: 'active' | 'archived';
}

const sectionSchema = new Schema<SectionDoc>(
  {
    orgId: { type: ObjectId, required: true },
    courseId: { type: ObjectId, required: true },
    name: { type: String, required: true, trim: true, maxlength: LIMITS.sectionName },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
  },
  baseOptions<SectionDoc>('courseSections'),
);
sectionSchema.index({ courseId: 1, name: 1 }, { unique: true });

export const Section = model<SectionDoc>('Section', sectionSchema);

export interface EnrollmentDoc extends Timestamps {
  _id: Id;
  orgId: Id;
  courseId: Id;
  userId: Id;
  role: EnrollmentRole;
  status: EnrollmentStatus;
  sectionId: Id | null;
  enrolledAt: Date;
  droppedAt: Date | null;
}

const enrollmentSchema = new Schema<EnrollmentDoc>(
  {
    orgId: { type: ObjectId, required: true },
    courseId: { type: ObjectId, required: true },
    userId: { type: ObjectId, required: true },
    role: { type: String, enum: ENROLLMENT_ROLES, required: true },
    status: { type: String, enum: ENROLLMENT_STATUSES, default: 'active' },
    sectionId: { type: ObjectId, default: null },
    enrolledAt: { type: Date, required: true },
    droppedAt: { type: Date, default: null },
  },
  baseOptions<EnrollmentDoc>('enrollments'),
);
enrollmentSchema.index({ courseId: 1, userId: 1 }, { unique: true });
enrollmentSchema.index({ userId: 1, orgId: 1, status: 1, role: 1 });
enrollmentSchema.index({ courseId: 1, role: 1, status: 1, sectionId: 1 });

export const Enrollment = model<EnrollmentDoc>('Enrollment', enrollmentSchema);
