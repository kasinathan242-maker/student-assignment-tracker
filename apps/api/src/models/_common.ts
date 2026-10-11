import { Schema, type SchemaOptions, Types } from 'mongoose';

export const ObjectId = Schema.Types.ObjectId;
export type Id = Types.ObjectId;

/** Default schema options: timestamps, no __v (we use an explicit `rev` where concurrency matters). */
export function baseOptions<T>(collection: string, extra: SchemaOptions<T> = {}): SchemaOptions<T> {
  return {
    collection,
    timestamps: true,
    versionKey: false,
    strict: true,
    ...extra,
  } as SchemaOptions<T>;
}

export interface Timestamps {
  createdAt: Date;
  updatedAt: Date;
}

export const toId = (value: string | Id): Id =>
  typeof value === 'string' ? new Types.ObjectId(value) : value;
export const isValidId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value) && Types.ObjectId.isValid(value);
