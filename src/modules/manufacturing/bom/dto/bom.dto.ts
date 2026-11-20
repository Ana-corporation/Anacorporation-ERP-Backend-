import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ListQuerySchema } from '@/common/dto/pagination.dto';
import { bigintIdSchema } from '@/common/zod/common.schemas';

/**
 * Quantities travel as strings or numbers and are parsed to Prisma.Decimal in the service, so each
 * failure returns its own BOM code (QTY_MUST_BE_POSITIVE, SCRAP_OUT_OF_RANGE ...). Objects pass
 * unknown keys through so the service can answer FIELD_NOT_ALLOWED for commonKey / lineType /
 * parentLineId instead of silently dropping them.
 */
const decimalInput = z.union([z.string().trim().max(40), z.number()]);
const emptyToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);
const optionalText = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());
const nullableText = (max: number) =>
  z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const dateInput = z.preprocess(
  (v) => (v === '' ? null : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date as YYYY-MM-DD').nullable().optional(),
);
const optionalId = z.preprocess(emptyToUndefined, bigintIdSchema.optional());

export const BomLineInputSchema = z
  .object({
    componentItemId: optionalId,
    quantity: decimalInput.optional(),
    /** Optional; must equal the item's inventory UOM (v1). The server fills it. */
    uomId: optionalId,
    /** null or '' clears it on update; omitted = unchanged. */
    findNumber: nullableText(20),
    scrapPercentage: decimalInput.optional(),
    remarks: nullableText(500),
  })
  .passthrough();

export const BomGroupInputSchema = z
  .object({
    main: BomLineInputSchema,
    subLines: z.array(BomLineInputSchema).max(500).optional().default([]),
  })
  .passthrough();

export const CreateBomSchema = z
  .object({
    /** Machine master id; the server uses the machine's linked item as the parent. */
    machineId: optionalId,
    parentItemId: optionalId,
    bomType: z.enum(['ENGINEERING', 'MANUFACTURING']).optional().default('MANUFACTURING'),
    /** CUSTOMER variant BOMs are a later phase. */
    bomScope: z.literal('STANDARD').optional().default('STANDARD'),
    baseQuantity: decimalInput.optional(),
    effectiveFrom: dateInput,
    effectiveTo: dateInput,
    revisionLabel: optionalText(10),
    remarks: optionalText(5000),
    groups: z.array(BomGroupInputSchema).max(1000).optional().default([]),
  })
  .passthrough();

export const UpdateBomSchema = z
  .object({
    rowVersion: z.coerce.number().int(),
    /** Version 1 drafts only (a revision keeps its parent and type). */
    parentItemId: optionalId,
    bomType: z.enum(['ENGINEERING', 'MANUFACTURING']).optional(),
    baseQuantity: decimalInput.optional(),
    effectiveFrom: dateInput,
    effectiveTo: dateInput,
    revisionLabel: nullableText(10),
    revisionReason: nullableText(2000),
    remarks: nullableText(5000),
  })
  .passthrough();

export const AddBomLineSchema = BomLineInputSchema.extend({
  /** Optional optimistic check of the BOM header. */
  rowVersion: z.coerce.number().int().optional(),
}).passthrough();

export const UpdateBomLineSchema = AddBomLineSchema;

export const DeleteBomLineQuerySchema = z.object({
  withSubLines: z.preprocess((v) => v === 'true' || v === true, z.boolean()).optional().default(false),
  rowVersion: z.coerce.number().int().optional(),
});

export const BomListQuerySchema = ListQuerySchema.extend({
  bomType: z.enum(['ENGINEERING', 'MANUFACTURING']).optional(),
  parentItemId: z.string().regex(/^\d+$/).optional(),
  /** Default: latest version of each BOM only. */
  allVersions: z.preprocess((v) => v === 'true' || v === true, z.boolean()).optional().default(false),
});

export const RequirementsSchema = z.object({
  productionQuantity: decimalInput,
});

export const ReleaseBomSchema = z.object({
  rowVersion: z.coerce.number().int().optional(),
});

export const ReviseBomSchema = z.object({
  revisionReason: z.string().trim().max(2000).optional(),
  revisionLabel: optionalText(10),
  rowVersion: z.coerce.number().int().optional(),
});

export const ReasonSchema = z.object({
  reason: z.string().trim().max(2000).optional(),
  rowVersion: z.coerce.number().int().optional(),
});

export const WhereUsedQuerySchema = z.object({
  itemId: bigintIdSchema,
  includeDrafts: z.preprocess((v) => v === 'true' || v === true, z.boolean()).optional().default(false),
});

export const ByItemQuerySchema = z.object({
  bomType: z.enum(['ENGINEERING', 'MANUFACTURING']).optional(),
});

export class CreateBomDto extends createZodDto(CreateBomSchema) {}
export class UpdateBomDto extends createZodDto(UpdateBomSchema) {}
export class AddBomLineDto extends createZodDto(AddBomLineSchema) {}
export class UpdateBomLineDto extends createZodDto(UpdateBomLineSchema) {}
export class DeleteBomLineQueryDto extends createZodDto(DeleteBomLineQuerySchema) {}
export class BomListQueryDto extends createZodDto(BomListQuerySchema) {}
export class RequirementsDto extends createZodDto(RequirementsSchema) {}
export class ReleaseBomDto extends createZodDto(ReleaseBomSchema) {}
export class ReviseBomDto extends createZodDto(ReviseBomSchema) {}
export class ReasonDto extends createZodDto(ReasonSchema) {}
export class WhereUsedQueryDto extends createZodDto(WhereUsedQuerySchema) {}
export class ByItemQueryDto extends createZodDto(ByItemQuerySchema) {}

export type BomLineInput = z.infer<typeof BomLineInputSchema>;
export type BomGroupInput = z.infer<typeof BomGroupInputSchema>;
