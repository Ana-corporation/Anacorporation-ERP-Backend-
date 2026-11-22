import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ListQuerySchema } from '@/common/dto/pagination.dto';
import { ITEM_STAGE_PLANS } from '../item-stages';

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
export const ITEM_STATUSES = ['draft', 'active', 'inactive', 'obsolete', 'advanced'] as const;
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
  /** Store category; required when the ITEM number series is active. Cannot change once set. */
  storeCategoryId: z.preprocess(
    emptyToUndefined,
    z.string().regex(/^\d+$/, 'Invalid storeCategoryId').optional(),
  ),
  /** Item Group master (must belong to the item's store). */
  itemGroupId: z.preprocess(
    emptyToUndefined,
    z.string().regex(/^\d+$/, 'Invalid itemGroupId').optional(),
  ),
  /** UOM master; also copied to inventory.uomName for stock screens. */
  inventoryUomId: z.preprocess(
    emptyToUndefined,
    z.string().regex(/^\d+$/, 'Invalid inventoryUomId').optional(),
  ),
  /** true = save even though another item in the same store has the same description. */
  confirmDuplicateName: z.boolean().optional(),
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
  /** UDF map keyed by fieldName — persisted in custom_field_values (entity=item). */
  customFields: z.record(z.string(), z.unknown()).optional(),

  isActive: z.boolean().optional(),
};

export const CreateItemSchema = z.object({
  // Optional: required only when company itemCodeMode = MANUAL (validated in service).
  // AUTO mode and an active ITEM number series ignore any client-supplied code.
  itemCode: z.preprocess(
    emptyToUndefined,
    z.string().trim().min(1).max(50).optional(),
  ),
  ...itemBaseShape,
  /**
   * Raw-material category only: also create the linked process part in the same save.
   * RM_ONLY = one part number; RM_PROCESS = RM + process category (PLT / MCN / …) — two part numbers.
   */
  stagePlan: z.enum(ITEM_STAGE_PLANS).optional(),
  /** Required when stagePlan = RM_PROCESS: process category code from the BOM (PLT, MCN, FAB, SPR, …). */
  processCategoryCode: z.preprocess(
    emptyToUndefined,
    z.string().trim().toUpperCase().regex(/^[A-Z]{2,4}$/, 'Use 2 to 4 letters A-Z').optional(),
  ),
}).superRefine((value, ctx) => {
  if (value.stagePlan === 'RM_PROCESS' && !value.processCategoryCode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['processCategoryCode'],
      message: 'Process category code is required for RM_PROCESS (e.g. PLT, MCN)',
    });
  }
});

/** Create the missing process part of an existing raw-material item. */
export const CreateItemStagesSchema = z.object({
  processCategoryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2,4}$/, 'Use 2 to 4 letters A-Z'),
});

export const UpdateItemSchema = z.object({
  ...itemBaseShape,
  description: z.string().trim().min(1).max(255).optional(),
  // itemCode intentionally omitted — immutable after create (no silent renames).
});

export const UpsertItemWarehouseStockSchema = z.object({
  warehouseId: z.string().regex(/^\d+$/, 'Invalid warehouseId'),
  isLocked: z.boolean().optional(),
  /** Ignored: on-hand stock changes only through posted inventory documents. */
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

export const ItemListQuerySchema = ListQuerySchema.extend({
  storeCategoryId: z.string().regex(/^\d+$/).optional(),
  /** Includes sub-groups of the selected group. */
  itemGroupId: z.string().regex(/^\d+$/).optional(),
  inventoryUomId: z.string().regex(/^\d+$/).optional(),
  /** Adds customFields { fieldName: value } to every row (list columns). */
  includeCustomFields: z
    .preprocess((v) => v === 'true' || v === true, z.boolean())
    .optional()
    .default(false),
  /** Material master list: hide items owned by the Machine master (BS500 ...). */
  excludeMachines: z.preprocess((v) => v === 'true' || v === true, z.boolean()).optional(),
  // cf.<fieldName>=<value> custom-field filters pass through.
}).passthrough();

/** cf.* query params, e.g. ?cf.materialType=Raw Material */
export function extractItemCfFilters(query: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (!key.startsWith('cf.')) continue;
    const fieldName = key.slice(3);
    if (!fieldName || value === undefined || value === null || value === '') continue;
    out[fieldName] = String(value);
  }
  return out;
}

export const ItemLookupQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  storeCategoryId: z.string().regex(/^\d+$/).optional(),
  itemGroupId: z.string().regex(/^\d+$/).optional(),
  /** Comma list, e.g. "Make,Subcontract" (BOM parent picker). Ignored when the company has no such field. */
  procurementType: z.string().trim().max(100).optional(),
  /** e.g. the BOM parent item, so it cannot be picked as its own component */
  excludeItemId: z.string().regex(/^\d+$/).optional(),
  /** Material pickers: hide items that belong to a Machine. */
  excludeMachines: z.preprocess((v) => v === 'true' || v === true, z.boolean()).optional(),
  /** Only items linked to a Machine. */
  onlyMachines: z.preprocess((v) => v === 'true' || v === true, z.boolean()).optional(),
});

export class ItemListQueryDto extends createZodDto(ItemListQuerySchema) {}
export class ItemLookupQueryDto extends createZodDto(ItemLookupQuerySchema) {}
export class CreateItemDto extends createZodDto(CreateItemSchema) {}
export class UpdateItemDto extends createZodDto(UpdateItemSchema) {}
export class UpsertItemWarehouseStockDto extends createZodDto(
  UpsertItemWarehouseStockSchema,
) {}
export class UpdateItemSettingsDto extends createZodDto(UpdateItemSettingsSchema) {}
export class CreateItemStagesDto extends createZodDto(CreateItemStagesSchema) {}
