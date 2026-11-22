import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ListQuerySchema } from '@/common/dto/pagination.dto';
import { bigintIdSchema } from '@/common/zod/common.schemas';

const emptyToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);
const optionalText = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());
const nullableText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const optionalId = z.preprocess(emptyToUndefined, bigintIdSchema.optional());

/** Code format and uniqueness are checked in the service so each failure returns its own code. */
export const CreateMachineSchema = z.object({
  machineCode: z.string().trim().max(40),
  name: z.string().trim().min(1).max(200),
  series: optionalText(20),
  model: optionalText(40),
  description: optionalText(5000),
  remarks: optionalText(5000),
  /** Attach an existing item instead of creating one (e.g. ANAASSY00012 for BS500). */
  linkItemId: optionalId,
});

export const UpdateMachineSchema = z.object({
  rowVersion: z.coerce.number().int(),
  name: z.string().trim().min(1).max(200).optional(),
  series: nullableText(20),
  model: nullableText(40),
  description: nullableText(5000),
  remarks: nullableText(5000),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export const CreateVariantSchema = z.object({
  salesOrderNo: z.string().trim().max(20),
  customerId: optionalId,
  remarks: optionalText(5000),
});

export const MachineListQuerySchema = ListQuerySchema.extend({
  type: z.enum(['BASE', 'ORDER']).optional(),
  baseMachineId: z.string().regex(/^\d+$/).optional(),
  customerId: z.string().regex(/^\d+$/).optional(),
});

export const MachineLookupQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  type: z.enum(['BASE', 'ORDER']).optional(),
});

export const MachineSettingsSchema = z.object({
  itemGroupId: bigintIdSchema,
  uomId: bigintIdSchema,
});

export class CreateMachineDto extends createZodDto(CreateMachineSchema) {}
export class UpdateMachineDto extends createZodDto(UpdateMachineSchema) {}
export class CreateVariantDto extends createZodDto(CreateVariantSchema) {}
export class MachineListQueryDto extends createZodDto(MachineListQuerySchema) {}
export class MachineLookupQueryDto extends createZodDto(MachineLookupQuerySchema) {}
export class MachineSettingsDto extends createZodDto(MachineSettingsSchema) {}
