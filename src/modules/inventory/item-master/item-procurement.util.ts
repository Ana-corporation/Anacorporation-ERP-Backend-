import { Prisma } from '@prisma/client';

/** Item custom field that holds Buy / Make / Subcontract for companies that define it. */
export const PROCUREMENT_FIELD_NAME = 'procurementType';
export const MAKE_PROCUREMENT_TYPES = ['MAKE', 'SUBCONTRACT'] as const;

export interface ProcurementLookup {
  /** False when the company has no active procurementType item field (rule is skipped). */
  hasField: boolean;
  byItemId: Map<string, string>;
}

/** Procurement type per item, read from the company's item custom field (no Item Master column). */
export async function loadProcurementTypes(
  db: Prisma.TransactionClient,
  companyId: bigint,
  itemIds: bigint[],
): Promise<ProcurementLookup> {
  const field = await db.customFieldDefinition.findFirst({
    where: { companyId, entityType: 'item', fieldName: PROCUREMENT_FIELD_NAME, deletedAt: null, isActive: true },
    select: { fieldId: true },
  });
  const byItemId = new Map<string, string>();
  if (!field) return { hasField: false, byItemId };
  if (itemIds.length === 0) return { hasField: true, byItemId };
  const values = await db.customFieldValue.findMany({
    where: { companyId, entityType: 'item', fieldId: field.fieldId, recordId: { in: itemIds } },
    select: { recordId: true, valueText: true },
  });
  for (const v of values) if (v.valueText) byItemId.set(v.recordId.toString(), v.valueText);
  return { hasField: true, byItemId };
}

export function isMakeProcurement(value: string | null | undefined): boolean {
  return MAKE_PROCUREMENT_TYPES.includes(String(value ?? '').trim().toUpperCase() as (typeof MAKE_PROCUREMENT_TYPES)[number]);
}
