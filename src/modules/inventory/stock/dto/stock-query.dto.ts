import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { StockMovementType } from '@prisma/client';
import { ListQuerySchema } from '@/common/dto/pagination.dto';
import { bigintIdSchema } from '@/common/zod/common.schemas';

const booleanParam = z.preprocess(
  (value) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value),
  z.boolean().optional(),
);

/** Comma list or repeated param: movementType=MATERIAL_ISSUE,ADJUSTMENT_OUT */
const movementTypes = z.preprocess(
  (value) =>
    value === undefined || value === ''
      ? undefined
      : (Array.isArray(value) ? value : String(value).split(','))
          .map((v) => String(v).trim().toUpperCase())
          .filter(Boolean),
  z.array(z.nativeEnum(StockMovementType)).optional(),
);

const stockFilterShape = {
  itemId: bigintIdSchema.optional(),
  siteId: bigintIdSchema.optional(),
  branchId: bigintIdSchema.optional(),
  storageBinId: bigintIdSchema.optional(),
};

export const CurrentStockQuerySchema = ListQuerySchema.extend({
  ...stockFilterShape,
  /** Default false: rows at 0 are hidden */
  includeZero: booleanParam,
});

export const StockLedgerQuerySchema = ListQuerySchema.extend({
  ...stockFilterShape,
  movementType: movementTypes,
  transactionType: movementTypes,
  documentNumber: z.string().trim().max(30).optional(),
});

export class CurrentStockQueryDto extends createZodDto(CurrentStockQuerySchema) {}
export class StockLedgerQueryDto extends createZodDto(StockLedgerQuerySchema) {}
