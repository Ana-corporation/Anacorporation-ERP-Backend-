import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema } from '@/common/zod/common.schemas';

const dateSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date as YYYY-MM-DD');

export const OpeningImportUploadSchema = z.object({
  /** Opening stock date; defaults to today */
  documentDate: dateSchema.optional(),
});

const cell = z.preprocess((v) => (v === null ? '' : typeof v === 'number' ? String(v) : v), z.string().max(255).optional());

/** Review-screen edit of one row. Cell values replace what was in the file. */
export const OpeningImportRowUpdateSchema = z.object({
  data: z
    .object({
      store: cell,
      categoryCode: cell,
      partNumber: cell,
      partName: cell,
      partCode: cell,
      materialGrade: cell,
      size: cell,
      uom: cell,
      status: cell,
      locationCode: cell,
      binCode: cell,
      vendorCode: cell,
      quantity: cell,
      unitPrice: cell,
      batchNo: cell,
      serialNo: cell,
      revision: cell,
      remarks: cell,
      machineModel: cell,
      machineNo: cell,
      category: cell,
    })
    .partial()
    .optional(),
  /** Confirm zero valuation for this matched row (Unit Price 0). */
  confirmZeroValuation: z.boolean().optional(),
});

export const OpeningImportExcludeSchema = z.object({
  rowIds: z.array(bigintIdSchema).min(1).max(5000),
  excluded: z.boolean(),
});

export const OpeningImportApproveSchema = z.object({
  /** Required when some rows have unit price 0 */
  confirmZeroPrice: z.boolean().optional().default(false),
});

export const OpeningImportRowsQuerySchema = z.object({
  matchStatus: z.enum(['MATCHED', 'ERROR']).optional(),
  excluded: z.preprocess((v) => (v === 'true' || v === true ? true : v === 'false' || v === false ? false : undefined), z.boolean().optional()),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
});

export const OpeningImportListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export class OpeningImportUploadDto extends createZodDto(OpeningImportUploadSchema) {}
export class OpeningImportRowUpdateDto extends createZodDto(OpeningImportRowUpdateSchema) {}
export class OpeningImportExcludeDto extends createZodDto(OpeningImportExcludeSchema) {}
export class OpeningImportApproveDto extends createZodDto(OpeningImportApproveSchema) {}
export class OpeningImportRowsQueryDto extends createZodDto(OpeningImportRowsQuerySchema) {}
export class OpeningImportListQueryDto extends createZodDto(OpeningImportListQuerySchema) {}
