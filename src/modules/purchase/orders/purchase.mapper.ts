import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { day, D, money } from './purchase.util';

type RequirementRow = Prisma.PurchaseRequirementGetPayload<{
  include: {
    item: { select: { itemId: true; itemCode: true; oldCode: true; description: true; currencyCode: true; preferredVendorId: true } };
  };
}>;

export function requirementView(
  row: RequirementRow,
  currencyId: string | null,
) {
  const open = D(row.requiredQty).minus(row.convertedQty);
  return {
    purchaseRequirementId: row.purchaseRequirementId.toString(),
    prNo: row.prNo,
    sourceType: row.sourceType,
    runId: row.runId?.toString() ?? null,
    machineId: row.machineId?.toString() ?? null,
    bomId: row.bomId?.toString() ?? null,
    bomVersion: row.bomVersion,
    bomNumber: row.bomNumber,
    itemId: row.itemId.toString(),
    partNo: row.item.itemCode,
    itemCode: row.item.itemCode,
    oldPartNo: row.item.oldCode,
    itemName: row.item.description,
    requiredQty: money(row.requiredQty),
    convertedQty: money(row.convertedQty),
    openQty: money(open.isNeg() ? 0 : open),
    requiredDate: day(row.requiredDate),
    warehouseId: row.warehouseId.toString(),
    uomId: row.uomId?.toString() ?? null,
    suggestedVendorId: row.suggestedVendorId?.toString() ?? null,
    currencyId,
    status: row.status,
    reason: row.reason ?? '',
    rowVersion: row.rowVersion,
  };
}

export function canApprovePurchase(user: AuthenticatedUser): boolean {
  if (user.role === 'super_admin') return true;
  return user.permissions.some((code) =>
    code === 'items:approve' || code === 'supply-chain:approve' || code === 'purchase_orders:approve',
  );
}

export function allowedActions(input: {
  status: string;
  buyerId: bigint;
  createdBy: bigint | null;
  user: AuthenticatedUser;
  selfApprovalAllowed: boolean;
}): string[] {
  const actor = BigInt(input.user.sub);
  const isBuyer = input.buyerId === actor || input.createdBy === actor;
  const approver = canApprovePurchase(input.user) && (input.selfApprovalAllowed || !isBuyer);
  switch (input.status) {
    case 'DRAFT':
    case 'REJECTED':
      return ['edit', 'submit', 'cancel'];
    case 'PENDING_APPROVAL':
      return [...(isBuyer ? ['withdraw'] : []), ...(approver ? ['approve', 'reject'] : [])];
    case 'APPROVED':
      return ['issue', 'amend', 'cancel'];
    case 'SENT':
      return ['resend', 'close'];
    case 'PARTIALLY_RECEIVED':
    case 'FULLY_RECEIVED':
      return ['close'];
    default:
      return [];
  }
}
