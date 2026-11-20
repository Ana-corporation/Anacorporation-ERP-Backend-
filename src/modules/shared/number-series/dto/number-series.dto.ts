import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ListQuerySchema } from '@/common/dto/pagination.dto';
import { bigintIdSchema, optionalNullableBigintIdSchema } from '@/common/zod/common.schemas';

/** Format rules (prefix / segment code / lengths / locks) are checked in the service so each
 * failure returns its own NUMBER_SERIES_* code. */
export const NumberSeriesConfigSchema = z.object({
  prefix: z.string().max(20).optional().default(''),
  segmentSource: z.enum(['STORE', 'ITEM_GROUP', 'NONE']),
  separator: z.enum(['NONE', 'HYPHEN', 'SLASH']).optional().default('NONE'),
  serialLengthDefault: z.coerce.number().int().optional().default(5),
  serialReset: z.enum(['NEVER', 'YEARLY', 'FISCAL_YEAR']).optional().default('NEVER'),
  /** Non-ITEM series: document-number template, e.g. "{PREFIX}/{FY}/{SEQ}". Empty/omitted = prefix+serial. */
  pattern: z.string().max(80).nullish(),
  isActive: z.boolean().optional().default(true),
  rowVersion: z.coerce.number().int().optional(),
});

export const NumberSeriesLineInputSchema = z.object({
  /** Store category id for STORE; null / omitted for NONE */
  segmentRefId: optionalNullableBigintIdSchema,
  /** '' = not set (no line is created; an unlocked line is removed) */
  segmentCode: z.string().max(20).optional().default(''),
  /** Omitted = keep the current value (1 for a new line) */
  startFrom: z.coerce.number().int().optional(),
  /** Defaults to config.serialLengthDefault */
  serialLength: z.coerce.number().int().optional(),
});

export const UpdateNumberSeriesSchema = z.object({
  config: NumberSeriesConfigSchema,
  lines: z.array(NumberSeriesLineInputSchema).max(200).optional().default([]),
});

export class UpdateNumberSeriesDto extends createZodDto(UpdateNumberSeriesSchema) {}

export const NumberSeriesPreviewQuerySchema = z.object({
  segmentRefId: bigintIdSchema.optional(),
});

export class NumberSeriesPreviewQueryDto extends createZodDto(NumberSeriesPreviewQuerySchema) {}

export const NumberSeriesAuditQuerySchema = ListQuerySchema.pick({ page: true, limit: true });

export class NumberSeriesAuditQueryDto extends createZodDto(NumberSeriesAuditQuerySchema) {}

export type NumberSeriesLineInput = z.infer<typeof NumberSeriesLineInputSchema>;
