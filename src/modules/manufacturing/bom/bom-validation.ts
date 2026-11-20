import { Prisma } from '@prisma/client';
import { isMakeProcurement, ProcurementLookup } from '@/modules/inventory/item-master/item-procurement.util';
import { BOM_ERROR_CODES, BOM_WARNING_CODES, BomIssue } from './bom.constants';
import { buildGroups } from './bom-groups';

type Decimal = Prisma.Decimal;
const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);
/** DECIMAL(19,6): at most 13 digits before the point. */
const MAX_QTY = new Prisma.Decimal('9999999999999.999999');

export interface ValidationItem {
  itemId: string;
  itemCode: string;
  isActive: boolean;
  status: string;
  inventoryUomId: string | null;
}

export interface ValidationLine {
  bomLineId: bigint;
  lineType: 'MAIN' | 'SUB';
  commonKey: string;
  parentLineId: bigint | null;
  lineNumber: number;
  componentItemId: string;
  quantity: Decimal;
  scrapPercentage: Decimal;
  uomId: string;
}

export interface ValidationHeader {
  parentItemId: string;
  uomId: string;
  baseQuantity: Decimal;
  version: number;
  revisionReason: string | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
}

export interface ValidationResult {
  valid: boolean;
  errors: BomIssue[];
  warnings: BomIssue[];
}

export const isItemInactive = (item: ValidationItem) => !item.isActive || item.status === 'inactive';
export const isItemObsolete = (item: ValidationItem) => item.status === 'obsolete';

/** Parse a client number / string into a Decimal; null when not a finite number. */
export function toDecimal(value: unknown): Decimal | null {
  if (value === null || value === undefined || value === '') return null;
  try {
    const d = new Prisma.Decimal(value as Prisma.Decimal.Value);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

export function checkQuantity(qty: Decimal | null, field: string, label = 'Quantity'): BomIssue[] {
  if (!qty || qty.lte(ZERO)) {
    return [{ field, code: BOM_ERROR_CODES.QTY_MUST_BE_POSITIVE, message: `${label} must be greater than zero` }];
  }
  if (qty.gt(MAX_QTY) || qty.decimalPlaces() > 6) {
    return [{ field, code: BOM_ERROR_CODES.QTY_MUST_BE_POSITIVE, message: `${label} allows 13 digits and 6 decimals` }];
  }
  return [];
}

export function checkScrap(scrap: Decimal | null, field: string): BomIssue[] {
  if (scrap === null) return [];
  if (scrap.lt(ZERO) || scrap.gt(HUNDRED) || scrap.decimalPlaces() > 4) {
    return [{ field, code: BOM_ERROR_CODES.SCRAP_OUT_OF_RANGE, message: 'Scrap % must be between 0 and 100 (4 decimals)' }];
  }
  return [];
}

export function checkEffectiveDates(from: Date | null, to: Date | null, field = 'effectiveTo'): BomIssue[] {
  if (from && to && from.getTime() > to.getTime()) {
    return [{ field, code: BOM_ERROR_CODES.EFFECTIVE_DATE_INVALID, message: 'Effective from must be on or before effective to' }];
  }
  return [];
}

/**
 * Checks for one line being added / changed (component, quantity, scrap, UOM, self reference,
 * duplicate within the group). `groupItemIds` = other items already in the same group.
 */
export function checkLineInput(params: {
  field: string;
  item: ValidationItem | undefined;
  componentItemId: string | null | undefined;
  quantity: Decimal | null;
  scrap: Decimal | null;
  uomId?: string | null;
  parentItemId: string;
  lineType: 'MAIN' | 'SUB';
  mainItemId?: string | null;
  groupItemIds?: string[];
  inactiveIsError?: boolean;
}): BomIssue[] {
  const { field, item, componentItemId } = params;
  const issues: BomIssue[] = [];
  if (!componentItemId) {
    issues.push({ field: `${field}.componentItemId`, code: BOM_ERROR_CODES.COMPONENT_REQUIRED, message: 'Select an item' });
  } else if (!item) {
    issues.push({ field: `${field}.componentItemId`, code: BOM_ERROR_CODES.COMPONENT_NOT_FOUND, message: 'Item not found' });
  } else {
    if ((params.inactiveIsError ?? true) && isItemInactive(item)) {
      issues.push({ field: `${field}.componentItemId`, code: BOM_ERROR_CODES.COMPONENT_INACTIVE, message: `Item ${item.itemCode} is inactive` });
    }
    if (item.itemId === params.parentItemId) {
      issues.push({ field: `${field}.componentItemId`, code: BOM_ERROR_CODES.SELF_REFERENCE, message: 'The parent machine cannot be used inside its own BOM' });
    } else if (params.lineType === 'SUB' && params.mainItemId && item.itemId === params.mainItemId) {
      issues.push({ field: `${field}.componentItemId`, code: BOM_ERROR_CODES.SELF_REFERENCE, message: 'A SUB line cannot use the same item as its MAIN line' });
    } else if (params.groupItemIds?.includes(item.itemId)) {
      issues.push({ field: `${field}.componentItemId`, code: BOM_ERROR_CODES.DUPLICATE_COMPONENT, message: `Item ${item.itemCode} is already in this group` });
    }
    if (!item.inventoryUomId) {
      issues.push({ field: `${field}.uomId`, code: BOM_ERROR_CODES.UOM_INVALID, message: `Item ${item.itemCode} has no inventory UOM` });
    } else if (params.uomId && params.uomId !== item.inventoryUomId) {
      issues.push({ field: `${field}.uomId`, code: BOM_ERROR_CODES.UOM_INVALID, message: "Line UOM must be the item's inventory UOM" });
    }
  }
  issues.push(...checkQuantity(params.quantity, `${field}.quantity`));
  issues.push(...checkScrap(params.scrap, `${field}.scrapPercentage`));
  return issues;
}

/** Parent machine rules: exists, active, Make / Subcontract (when the company defines procurement type). */
export function checkParent(parent: ValidationItem | undefined, procurement: ProcurementLookup, field = 'parentItemId'): BomIssue[] {
  if (!parent) return [{ field, code: BOM_ERROR_CODES.PARENT_ITEM_REQUIRED, message: 'Select the parent machine item' }];
  const issues: BomIssue[] = [];
  if (isItemInactive(parent)) {
    issues.push({ field, code: BOM_ERROR_CODES.PARENT_ITEM_INACTIVE, message: `Item ${parent.itemCode} is inactive` });
  }
  if (procurement.hasField && !isMakeProcurement(procurement.byItemId.get(parent.itemId))) {
    issues.push({
      field,
      code: BOM_ERROR_CODES.PARENT_NOT_MAKE_ITEM,
      message: `Only Make or Subcontract items can have a BOM (${parent.itemCode} is ${procurement.byItemId.get(parent.itemId) ?? 'not set'})`,
    });
  }
  if (!parent.inventoryUomId) {
    issues.push({ field, code: BOM_ERROR_CODES.UOM_INVALID, message: `Item ${parent.itemCode} has no inventory UOM` });
  }
  return issues;
}

/** Whole-BOM check. mode 'release' also requires lines and turns inactive components into errors. */
export function validateBom(params: {
  mode: 'draft' | 'release';
  header: ValidationHeader;
  items: Map<string, ValidationItem>;
  procurement: ProcurementLookup;
  lines: ValidationLine[];
}): ValidationResult {
  const { mode, header, items, procurement, lines } = params;
  const errors: BomIssue[] = [];
  const warnings: BomIssue[] = [];
  const parent = items.get(header.parentItemId);

  errors.push(...checkParent(parent, procurement));
  if (parent?.inventoryUomId && header.uomId !== parent.inventoryUomId) {
    errors.push({ field: 'uomId', code: BOM_ERROR_CODES.UOM_INVALID, message: "BOM UOM must be the parent item's inventory UOM" });
  }
  errors.push(...checkQuantity(header.baseQuantity, 'baseQuantity', 'Base quantity'));
  errors.push(...checkEffectiveDates(header.effectiveFrom, header.effectiveTo));
  if (header.version > 1 && !header.revisionReason?.trim()) {
    errors.push({ field: 'revisionReason', code: BOM_ERROR_CODES.REVISION_REASON_REQUIRED, message: 'Revision reason is required' });
  }

  const groups = buildGroups(lines);
  if (mode === 'release' && !groups.some((g) => g.main)) {
    errors.push({ field: 'groups', code: BOM_ERROR_CODES.LINES_REQUIRED, message: 'Add at least one MAIN line before release' });
  }

  groups.forEach((group, gi) => {
    const groupPath = `groups.${gi}`;
    if (!group.main) {
      for (const sub of group.subLines) {
        errors.push({
          field: `${groupPath}.subLines.${group.subLines.indexOf(sub)}.parentLineId`,
          code: BOM_ERROR_CODES.MAIN_LINE_NOT_FOUND,
          message: 'SUB line has no MAIN line in this BOM',
          lineId: sub.bomLineId.toString(),
        });
      }
      return;
    }
    const main = group.main;
    const lineIssues = (line: ValidationLine, field: string, extra: Partial<Parameters<typeof checkLineInput>[0]>) => {
      const item = items.get(line.componentItemId);
      const found = checkLineInput({
        field,
        item,
        componentItemId: line.componentItemId,
        quantity: line.quantity,
        scrap: line.scrapPercentage,
        uomId: line.uomId,
        parentItemId: header.parentItemId,
        lineType: line.lineType,
        inactiveIsError: mode === 'release',
        ...extra,
      });
      errors.push(...found.map((i) => ({ ...i, lineId: line.bomLineId.toString() })));
      if (item && isItemInactive(item) && mode === 'draft') {
        warnings.push({ field: `${field}.componentItemId`, code: BOM_WARNING_CODES.COMPONENT_INACTIVE, message: `Item ${item.itemCode} is inactive (release will be blocked)`, lineId: line.bomLineId.toString() });
      }
      if (item && isItemObsolete(item)) {
        warnings.push({ field: `${field}.componentItemId`, code: BOM_WARNING_CODES.COMPONENT_OBSOLETE, message: `Item ${item.itemCode} is obsolete`, lineId: line.bomLineId.toString() });
      }
    };

    lineIssues(main, `${groupPath}.main`, {});
    const seen: string[] = [];
    group.subLines.forEach((sub, si) => {
      const field = `${groupPath}.subLines.${si}`;
      if (sub.commonKey !== main.commonKey) {
        errors.push({ field: `${field}.commonKey`, code: BOM_ERROR_CODES.SUB_PARENT_MUST_BE_MAIN, message: "SUB line key differs from its MAIN line's key", lineId: sub.bomLineId.toString() });
      }
      lineIssues(sub, field, { mainItemId: main.componentItemId, groupItemIds: [...seen] });
      seen.push(sub.componentItemId);
    });

    if (group.subLines.length === 0 && procurement.hasField && isMakeProcurement(procurement.byItemId.get(main.componentItemId))) {
      warnings.push({
        field: `${groupPath}.main`,
        code: BOM_WARNING_CODES.MAIN_WITHOUT_SUB_LINES,
        message: `Assembly ${items.get(main.componentItemId)?.itemCode ?? ''} has no SUB lines`.trim(),
        lineId: main.bomLineId.toString(),
      });
    }
  });

  return { valid: errors.length === 0, errors, warnings };
}
