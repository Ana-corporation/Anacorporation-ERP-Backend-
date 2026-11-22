import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ListQuerySchema } from '@/common/dto/pagination.dto';
import { bigintIdSchema, optionalNullableBigintIdSchema } from '@/common/zod/common.schemas';

const emptyToUndefined = (value: unknown) => (value === '' || value === null ? undefined : value);

const optionalText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

const requiredText = (max: number) => z.string().trim().min(1).max(max);

const dateSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date as YYYY-MM-DD');

/** Kept as a decimal string (max 12 digits + 6 decimals) so no float rounding reaches the ledger. */
const quantitySchema = (positive: boolean) =>
  z.preprocess(
    (value) => (typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : value),
    z
      .string()
      .regex(/^\d{1,12}(\.\d{1,6})?$/, 'Enter a number ≥ 0 with up to 6 decimals')
      .refine((value) => !positive || Number(value) > 0, 'Must be greater than 0'),
  );

/** Site = Branch master; Inventory Location = Warehouse master. Either name is accepted. */
const lineLocationShape = {
  itemId: bigintIdSchema,
  siteId: optionalNullableBigintIdSchema,
  branchId: optionalNullableBigintIdSchema,
  inventoryLocationId: optionalNullableBigintIdSchema,
  warehouseId: optionalNullableBigintIdSchema,
  storageBinId: optionalNullableBigintIdSchema,
  /** The Sub Contractor store (Store Type SUBCONTRACTOR) instead of a location; needs vendorId */
  storeCategoryId: optionalNullableBigintIdSchema,
  /** Vendor holding the stock: required with the Sub Contractor store, not allowed elsewhere */
  vendorId: optionalNullableBigintIdSchema,
  /** Optional check only: must equal the Item Master inventory UoM when sent */
  uom: optionalText(40),
  remarks: optionalText(255),
  /** Batch / Heat / Lot No. and serial: reference text (stock is not kept per batch / serial yet) */
  batchNo: optionalText(60),
  serialNo: optionalText(80),
};

const withLocation = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object({ ...lineLocationShape, ...shape })
    .refine((line) => {
      const location = line as { inventoryLocationId?: string | null; warehouseId?: string | null; storeCategoryId?: string | null };
      return Boolean(location.inventoryLocationId || location.warehouseId || location.storeCategoryId);
    }, {
      message: 'inventoryLocationId is required',
      path: ['inventoryLocationId'],
    });

const headerShape = {
  documentDate: dateSchema,
  remarks: optionalText(4000),
};

export const MAX_DOCUMENT_LINES = 3000;

const linesOf = <T extends z.ZodTypeAny>(line: T) => z.array(line).min(1).max(MAX_DOCUMENT_LINES);

export const OpeningStockSchema = z.object({
  ...headerShape,
  /** Header "Store": default location for new lines (each line keeps its own location) */
  defaultWarehouseId: optionalNullableBigintIdSchema,
  /** Header "Store" = the Sub Contractor store (instead of defaultWarehouseId); lines pick the vendor */
  defaultStoreCategoryId: optionalNullableBigintIdSchema,
  lines: linesOf(
    withLocation({
      quantity: quantitySchema(true),
      unitPrice: z.preprocess(emptyToUndefined, quantitySchema(false).optional()),
      /** Unit price 0 / blank accepted on purpose (otherwise posting is refused) */
      zeroPriceConfirmed: z.boolean().optional().default(false),
    }),
  ),
});

export const MaterialIssueSchema = z.object({
  ...headerShape,
  requestedBy: requiredText(150),
  issuedBy: optionalText(150),
  departmentId: optionalNullableBigintIdSchema,
  purpose: optionalText(255),
  lines: linesOf(withLocation({ quantity: quantitySchema(true) })),
});

export const StockAdjustmentSchema = z.object({
  ...headerShape,
  reason: requiredText(255),
  lines: linesOf(withLocation({ physicalQuantity: quantitySchema(false) })),
});

/** Same-store bin-to-bin transfer (phase 1). from = storageBinId, to = toStorageBinId. */
export const StockTransferSchema = z.object({
  ...headerShape,
  lines: linesOf(
    withLocation({
      quantity: quantitySchema(true),
      toStorageBinId: bigintIdSchema,
    }),
  ),
});

export class OpeningStockDto extends createZodDto(OpeningStockSchema) {}
export class MaterialIssueDto extends createZodDto(MaterialIssueSchema) {}
export class StockAdjustmentDto extends createZodDto(StockAdjustmentSchema) {}
export class StockTransferDto extends createZodDto(StockTransferSchema) {}

const lineInputSchema = z.object({
  ...lineLocationShape,
  toStorageBinId: optionalNullableBigintIdSchema,
  quantity: z.string().optional(),
  unitPrice: z.string().optional(),
  physicalQuantity: z.string().optional(),
  zeroPriceConfirmed: z.boolean().optional(),
});
export type InventoryDocumentLineInput = z.infer<typeof lineInputSchema>;

/** Common shape of the inventory document bodies after validation. */
export interface InventoryDocumentInput {
  documentDate: string;
  remarks?: string;
  defaultWarehouseId?: string | null;
  defaultStoreCategoryId?: string | null;
  requestedBy?: string;
  issuedBy?: string;
  departmentId?: string | null;
  purpose?: string;
  reason?: string;
  lines: InventoryDocumentLineInput[];
}

export const InventoryDocumentListQuerySchema = ListQuerySchema.extend({
  itemId: bigintIdSchema.optional(),
  /** Documents with at least one line in this store (warehouse). */
  inventoryLocationId: bigintIdSchema.optional(),
  documentNumber: z.string().trim().optional(),
});
export class InventoryDocumentListQueryDto extends createZodDto(InventoryDocumentListQuerySchema) {}
