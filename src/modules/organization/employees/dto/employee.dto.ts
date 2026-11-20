import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { optionalNullableBigintIdSchema, optionalPatchBigintIdSchema } from '@/common/zod/common.schemas';
import { optionalNullablePhoneE164Schema } from '@/common/utils/phone.util';

const emptyToNull = (value: unknown) => (value === '' || value === undefined ? null : value);

const optionalTrimmed = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullable().optional());

export const EMPLOYMENT_TYPES = [
  'full_time',
  'part_time',
  'contract',
  'intern',
  'consultant',
  'apprentice',
  'daily_wage',
] as const;

export const EMPLOYMENT_STATUSES = [
  'active',
  'inactive',
  'terminated',
  'on_leave',
  'candidate',
  'suspended',
  'notice_period',
  'exited',
] as const;

/** Default lookup: people ERP screens can pick (salesperson, store-keeper, approver). */
export const LOOKUP_EMPLOYMENT_STATUSES = ['active', 'on_leave', 'notice_period'] as const;

export const CreateEmployeeSchema = z.object({
  /** Omit/empty → auto EMP00001 from the EMPLOYEE number series. */
  employeeCode: z.preprocess(emptyToNull, z.string().trim().min(1).max(40).nullable().optional()),
  firstName: z.string().trim().min(1).max(100),
  middleName: optionalTrimmed(100),
  lastName: z.preprocess((v) => (v === null || v === undefined ? '' : v), z.string().trim().max(100).default('')),
  preferredName: optionalTrimmed(100),
  email: z.preprocess(emptyToNull, z.string().trim().email().max(255).nullable().optional()),
  mobile: optionalNullablePhoneE164Schema,
  branchId: optionalNullableBigintIdSchema,
  warehouseId: optionalNullableBigintIdSchema,
  departmentId: optionalNullableBigintIdSchema,
  designationId: optionalNullableBigintIdSchema,
  reportingManagerId: optionalNullableBigintIdSchema,
  joiningDate: z.preprocess(emptyToNull, z.string().date().nullable().optional()),
  employmentType: z.enum(EMPLOYMENT_TYPES).nullable().optional(),
  employmentStatus: z.enum(EMPLOYMENT_STATUSES).optional().default('active'),
});

export const UpdateEmployeeSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  middleName: optionalTrimmed(100),
  lastName: z.string().trim().max(100).nullable().optional(),
  preferredName: optionalTrimmed(100),
  email: z.preprocess(emptyToNull, z.string().trim().email().max(255).nullable().optional()),
  mobile: optionalNullablePhoneE164Schema,
  branchId: optionalPatchBigintIdSchema,
  warehouseId: optionalPatchBigintIdSchema,
  departmentId: optionalPatchBigintIdSchema,
  designationId: optionalPatchBigintIdSchema,
  reportingManagerId: optionalPatchBigintIdSchema,
  joiningDate: z.preprocess(emptyToNull, z.string().date().nullable().optional()),
  employmentType: z.enum(EMPLOYMENT_TYPES).nullable().optional(),
  employmentStatus: z.enum(EMPLOYMENT_STATUSES).optional(),
  profilePhoto: z.preprocess(emptyToNull, z.string().trim().max(500).nullable().optional()),
});

export const EmployeeLookupQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  departmentId: optionalNullableBigintIdSchema,
  designationId: optionalNullableBigintIdSchema,
  warehouseId: optionalNullableBigintIdSchema,
  branchId: optionalNullableBigintIdSchema,
  /** Omit = active + on_leave + notice_period (ERP pickers). Pass one status to narrow. */
  status: z.enum(EMPLOYMENT_STATUSES).optional(),
});

export class CreateEmployeeDto extends createZodDto(CreateEmployeeSchema) {}
export class UpdateEmployeeDto extends createZodDto(UpdateEmployeeSchema) {}
export class EmployeeLookupQueryDto extends createZodDto(EmployeeLookupQuerySchema) {}

/** Optional invite fields — existing FE fields stay valid. */
export const InviteEmployeeLinkSchema = z.object({
  employeeRecordId: optionalNullableBigintIdSchema,
  personType: z.enum(['EMPLOYEE', 'EXTERNAL']).optional(),
});
