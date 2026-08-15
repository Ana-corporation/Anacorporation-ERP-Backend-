import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/** Sizes mirror prisma/inventory/items.prisma so validation fails before Postgres does. */
const emptyToUndefined = (value: unknown) =>
  value === '' || value === null ? undefined : value;

const optionalText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

const optionalDecimal = z.preprocess(
  emptyToUndefined,
  z.coerce.number().finite().optional(),
);

const optionalInt = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().optional(),
);

/** Kept as a string: z.date() has no JSON Schema form and breaks Swagger generation. */
const optionalDate = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/, 'Expected date as YYYY-MM-DD')
    .optional(),
);

const jsonBag = z.record(z.string(), z.unknown()).optional();

/**
 * JSON bags are OPEN records (no key allow-list / no strip).
 * FE Item Master SAP gap fields are accepted as-is, including:
 *   purchase:   factor1..4 (+ existing purchasing keys)
 *   sales:      packagingUomName, length/width/height, volume, volumeUnit,
 *               weight, factor1..4 (+ existing sales keys)
 *   inventory:  weight (+ existing inventory keys)
 *   planning:   orderInterval (+ existing planning keys)
 *   production: bomType, itemComponentCount?, resourceComponentCount?
 *   properties: P1..P64 boolean map (no max-32 limit)
 */

export const ITEM_TYPES = ['item', 'service', 'labor', 'travel'] as const;
export const ITEM_MANAGE_BY = ['none', 'serial', 'batch'] as const;
export const ITEM_STATUSES = ['active', 'inactive', 'advanced'] as const;
export const ITEM_VALUATION_METHODS = [
  'moving_average',
  'standard',
  'fifo',
  'serial_batch',
] as const;

const itemBaseShape = {
  description: z.string().trim().min(1).max(255),
  oldCode: optionalText(50),
  itemType: z.enum(ITEM_TYPES).optional(),
  itemGroup: optionalText(80),
  uomGroup: optionalText(80),
  barcode: optionalText(100),
  priceList: optionalText(80),
  unitPrice: optionalDecimal,
  currencyCode: optionalText(10),

  isInventoryItem: z.boolean().optional(),
  isSalesItem: z.boolean().optional(),
  isPurchaseItem: z.boolean().optional(),

  doNotApplyDiscountGroups: z.boolean().optional(),
  manufacturer: optionalText(120),
  additionalIdentifier: optionalText(80),
  shippingType: optionalText(40),
  manageBy: z.enum(ITEM_MANAGE_BY).optional(),
  status: z.enum(ITEM_STATUSES).optional(),
  activeFrom: optionalDate,
  activeTo: optionalDate,

  netWeightKg: optionalDecimal,
  grossWeightKg: optionalDecimal,
  division: optionalText(80),
  coreActivity: optionalText(80),
  majorGroup: optionalText(120),
  brandName: optionalText(80),
  effectiveDate: optionalDate,
  customerStockNo: optionalText(80),
  stockToBe: optionalText(80),
  stockDioDays: optionalInt,
  contractItemsFor: optionalText(120),

  preferredVendorId: z.preprocess(
    emptyToUndefined,
    z.string().regex(/^\d+$/, 'Invalid preferredVendorId').optional(),
  ),
  valuationMethod: z.enum(ITEM_VALUATION_METHODS).optional(),
  itemCost: optionalDecimal,
  manageStockByWarehouse: z.boolean().optional(),

  remarks: z.preprocess(emptyToUndefined, z.string().optional()),

  purchase: jsonBag,
  sales: jsonBag,
  inventory: jsonBag,
  planning: jsonBag,
  production: jsonBag,
  properties: jsonBag,
  attachments: z.array(z.record(z.string(), z.unknown())).optional(),
  metadata: jsonBag,

  isActive: z.boolean().optional(),
};

export const CreateItemSchema = z.object({
  // Optional: required only when company itemCodeMode = MANUAL (validated in service).
  // AUTO mode ignores any client-supplied code and generates ITM-###### on BE.
  itemCode: z.preprocess(
    emptyToUndefined,
    z.string().trim().min(1).max(50).optional(),
  ),
  ...itemBaseShape,
});

export const UpdateItemSchema = z.object({
  ...itemBaseShape,
  description: z.string().trim().min(1).max(255).optional(),
  // itemCode intentionally omitted — immutable after create (no silent renames).
});

export const UpsertItemWarehouseStockSchema = z.object({
  warehouseId: z.string().regex(/^\d+$/, 'Invalid warehouseId'),
  isLocked: z.boolean().optional(),
  qtyOnHand: optionalDecimal,
  qtyCommitted: optionalDecimal,
  qtyOrdered: optionalDecimal,
  requiredQty: optionalDecimal,
  minimumQty: optionalDecimal,
  maximumQty: optionalDecimal,
  firstBinLocation: optionalText(80),
  defaultBinLocation: optionalText(80),
  enforceDefaultBin: z.boolean().optional(),
});

export const UpdateItemSettingsSchema = z.object({
  itemCodeMode: z.enum(['AUTO', 'MANUAL']),
  itemCodePrefix: z
    .string()
    .trim()
    .min(1)
    .max(10)
    .regex(/^[A-Za-z0-9]+$/, 'itemCodePrefix must be alphanumeric')
    .optional(),
});

export class CreateItemDto extends createZodDto(CreateItemSchema) {}
export class UpdateItemDto extends createZodDto(UpdateItemSchema) {}
export class UpsertItemWarehouseStockDto extends createZodDto(
  UpsertItemWarehouseStockSchema,
) {}
export class UpdateItemSettingsDto extends createZodDto(UpdateItemSettingsSchema) {}
