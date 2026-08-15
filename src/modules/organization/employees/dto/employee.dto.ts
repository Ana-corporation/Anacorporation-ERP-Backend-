import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import {
  bigintIdSchema,
  optionalNullableBigintIdSchema,
  optionalPatchBigintIdSchema,
} from '@/common/zod/common.schemas';

const emptyToNull = (value: unknown) =>
  value === '' || value === undefined ? null : value;

export const CreateEmployeeSchema = z.object({
  employeeCode: z.string().trim().min(1).max(40),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.preprocess(
    (v) => (v === null || v === undefined ? '' : v),
    z.string().trim().max(100).default(''),
  ),
  email: z.preprocess(emptyToNull, z.string().trim().email().max(255).nullable().optional()),
  mobile: z.preprocess(emptyToNull, z.string().trim().max(30).nullable().optional()),
  branchId: optionalNullableBigintIdSchema,
  departmentId: optionalNullableBigintIdSchema,
  designationId: optionalNullableBigintIdSchema,
  reportingManagerId: optionalNullableBigintIdSchema,
  joiningDate: z.preprocess(emptyToNull, z.string().date().nullable().optional()),
  employmentType: z
    .enum(['full_time', 'part_time', 'contract', 'intern', 'consultant'])
    .nullable()
    .optional(),
  employmentStatus: z
    .enum(['active', 'inactive', 'terminated', 'on_leave'])
    .optional()
    .default('active'),
});

export const UpdateEmployeeSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().max(100).nullable().optional(),
  email: z.preprocess(emptyToNull, z.string().trim().email().max(255).nullable().optional()),
  mobile: z.preprocess(emptyToNull, z.string().trim().max(30).nullable().optional()),
  branchId: optionalPatchBigintIdSchema,
  departmentId: optionalPatchBigintIdSchema,
  designationId: optionalPatchBigintIdSchema,
  reportingManagerId: optionalPatchBigintIdSchema,
  joiningDate: z.preprocess(emptyToNull, z.string().date().nullable().optional()),
  employmentType: z
    .enum(['full_time', 'part_time', 'contract', 'intern', 'consultant'])
    .nullable()
    .optional(),
  employmentStatus: z.enum(['active', 'inactive', 'terminated', 'on_leave']).optional(),
  profilePhoto: z.preprocess(emptyToNull, z.string().trim().max(500).nullable().optional()),
});

export class CreateEmployeeDto extends createZodDto(CreateEmployeeSchema) {}
export class UpdateEmployeeDto extends createZodDto(UpdateEmployeeSchema) {}

/** Optional invite fields — existing FE fields stay valid. */
export const InviteEmployeeLinkSchema = z.object({
  /** Existing employee master id (optional). */
  employeeRecordId: optionalNullableBigintIdSchema,
  /** EMPLOYEE creates/links employee master; EXTERNAL does not. Default inferred. */
  personType: z.enum(['EMPLOYEE', 'EXTERNAL']).optional(),
});
