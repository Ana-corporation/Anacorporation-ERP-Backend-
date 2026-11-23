import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ListQuerySchema } from '@/common/dto/pagination.dto';
import { bigintIdSchema, optionalNullableBigintIdSchema } from '@/common/zod/common.schemas';

const emptyToUndefined = (value: unknown) => (value === '' || value === null ? undefined : value);

const optionalText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

const dateSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date as YYYY-MM-DD');

const optionalDateSchema = z.preprocess(emptyToUndefined, dateSchema.optional());

const requiredId = (label: string) =>
  z.preprocess((value) => {
    if (value === '' || value === null || value === undefined) return '';
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return String(value);
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'string') return value.trim();
    return value;
  }, z.string().regex(/^\d+$/, `${label} is required`));

const decimalSchema = (positive: boolean) =>
  z.preprocess(
    (value) => (typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : value),
    z
      .string()
      .regex(/^\d{1,12}(\.\d{1,6})?$/, 'Enter a number with up to 6 decimals')
      .refine((value) => !positive || Number(value) > 0, 'Must be greater than 0'),
  );

const optionalStatus = <T extends [string, ...string[]]>(values: T) =>
  z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? undefined : value),
    z.enum(values).optional(),
  );

export const RequirementListSchema = ListQuerySchema.extend({
  status: optionalStatus([
    'DRAFT',
    'PENDING_REVIEW',
    'APPROVED',
    'PARTIALLY_CONVERTED',
    'FULLY_CONVERTED',
    'CANCELLED',
  ]),
  sourceType: optionalStatus(['SHORTAGE', 'REPLENISHMENT']),
});

export class RequirementListQueryDto extends createZodDto(RequirementListSchema) {}

export const CreateRequirementSchema = z.object({
  sourceType: z.literal('REPLENISHMENT').optional().default('REPLENISHMENT'),
  itemId: bigintIdSchema,
  warehouseId: bigintIdSchema,
  uomId: bigintIdSchema,
  requiredQty: decimalSchema(true),
  requiredDate: dateSchema,
  suggestedVendorId: optionalNullableBigintIdSchema.optional(),
  reason: z.string().trim().min(1).max(2000),
});

export class CreateRequirementDto extends createZodDto(CreateRequirementSchema) {}

export const UpdateRequirementSchema = z.object({
  requiredQty: decimalSchema(true).optional(),
  requiredDate: dateSchema.optional(),
  suggestedVendorId: optionalNullableBigintIdSchema.optional(),
  reason: optionalText(2000),
  rowVersion: z.coerce.number().int().positive(),
});

export class UpdateRequirementDto extends createZodDto(UpdateRequirementSchema) {}

export const RowVersionSchema = z.object({
  rowVersion: z.coerce.number().int().positive(),
});

export class RowVersionDto extends createZodDto(RowVersionSchema) {}

export const BomRunSchema = z.object({
  machineId: bigintIdSchema,
  bomId: bigintIdSchema,
  machineQty: z.preprocess(
    (value) => (typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : value),
    z.string().regex(/^[1-9]\d*$/, 'Quantity must be a whole number greater than 0'),
  ),
  warehouseId: bigintIdSchema,
  requiredDate: dateSchema,
});

export class BomRunDto extends createZodDto(BomRunSchema) {}

export const ConsolidateSchema = z.object({
  purchaseRequirementIds: z.array(bigintIdSchema).min(1),
});

export class ConsolidateDto extends createZodDto(ConsolidateSchema) {}

export const PurchaseOrderListSchema = ListQuerySchema.extend({
  status: optionalStatus([
    'DRAFT',
    'PENDING_APPROVAL',
    'APPROVED',
    'SENT',
    'PARTIALLY_RECEIVED',
    'FULLY_RECEIVED',
    'CLOSED',
    'REJECTED',
    'CANCELLED',
  ]),
  sendStatus: optionalStatus(['NOT_SENT', 'QUEUED', 'SENT', 'FAILED']),
  poType: optionalStatus(['PRODUCTION', 'REPLENISHMENT']),
  approvalQueue: optionalStatus(['mine']),
  vendorId: bigintIdSchema.optional(),
  warehouseId: bigintIdSchema.optional(),
  buyerId: bigintIdSchema.optional(),
  dateFrom: dateSchema.optional(),
  dateTo: dateSchema.optional(),
});

export class PurchaseOrderListQueryDto extends createZodDto(PurchaseOrderListSchema) {}

const lineSourceSchema = z.object({
  purchaseRequirementId: bigintIdSchema,
  qty: decimalSchema(true),
});

const orderLineSchema = z.object({
  itemId: bigintIdSchema,
  description: optionalText(500),
  uomId: bigintIdSchema,
  orderedQty: decimalSchema(true),
  unitPrice: decimalSchema(false),
  taxPct: decimalSchema(false),
  discountAmount: decimalSchema(false).optional().default('0'),
  requiredDate: optionalDateSchema,
  warehouseId: bigintIdSchema,
  varianceReason: optionalText(2000),
  sources: z.array(lineSourceSchema).optional().default([]),
});

export const SavePurchaseOrderSchema = z
  .object({
    poType: z.enum(['PRODUCTION', 'REPLENISHMENT']),
    vendorId: requiredId('Vendor'),
    poDate: dateSchema,
    currencyId: bigintIdSchema,
    paymentTermId: bigintIdSchema,
    deliveryDate: dateSchema,
    warehouseId: bigintIdSchema,
    vendorReference: optionalText(80),
    internalNotes: optionalText(4000),
    supplierNotes: optionalText(4000),
    reason: optionalText(2000),
    lines: z.array(orderLineSchema).min(1),
    rowVersion: z.coerce.number().int().positive().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.poType === 'REPLENISHMENT' && !value.reason) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Reason is required for replenishment' });
    }
  });

export class SavePurchaseOrderDto extends createZodDto(SavePurchaseOrderSchema) {}

export const ApproveSchema = RowVersionSchema.extend({
  comment: optionalText(2000),
});
export class ApproveDto extends createZodDto(ApproveSchema) {}

export const ReasonSchema = RowVersionSchema.extend({
  reason: z.string().trim().min(1).max(2000),
});
export class ReasonDto extends createZodDto(ReasonSchema) {}

export const RejectSchema = RowVersionSchema.extend({
  comment: z.string().trim().min(1).max(2000),
});
export class RejectDto extends createZodDto(RejectSchema) {}

export const EmailAttemptListSchema = ListQuerySchema.extend({
  status: optionalStatus(['QUEUED', 'SENT', 'FAILED']),
});
export class EmailAttemptListQueryDto extends createZodDto(EmailAttemptListSchema) {}

export const DashboardSchema = z.object({
  dateFrom: dateSchema.optional(),
  dateTo: dateSchema.optional(),
  vendorId: bigintIdSchema.optional(),
  warehouseId: bigintIdSchema.optional(),
  buyerId: bigintIdSchema.optional(),
  poType: optionalStatus(['PRODUCTION', 'REPLENISHMENT']),
});
export class DashboardQueryDto extends createZodDto(DashboardSchema) {}

export const PurchaseSettingsSchema = z.object({
  selfApprovalAllowed: z.boolean(),
  overReceiptTolerancePct: decimalSchema(false),
  emailMaxAttempts: z.coerce.number().int().min(1).max(20),
  emailRetryIntervalSeconds: z.coerce.number().int().min(0).max(86400),
  emailSubjectTemplate: optionalText(200),
  emailBodyTemplate: optionalText(8000),
  rowVersion: z.coerce.number().int().positive(),
});
export class PurchaseSettingsDto extends createZodDto(PurchaseSettingsSchema) {}

const approvalRuleSchema = z.object({
  purchaseApprovalRuleId: bigintIdSchema.optional(),
  poType: z.enum(['PRODUCTION', 'REPLENISHMENT']),
  amountFrom: decimalSchema(false),
  amountTo: z.preprocess(
    (value) => (value === '' || value === undefined ? null : value),
    z.union([decimalSchema(false), z.null()]),
  ),
  currencyId: bigintIdSchema,
  approverRoleId: bigintIdSchema,
  isActive: z.boolean().optional().default(true),
  rowVersion: z.coerce.number().int().positive().optional(),
});

export const SaveApprovalRulesSchema = z.object({
  rules: z.array(approvalRuleSchema),
});
export class SaveApprovalRulesDto extends createZodDto(SaveApprovalRulesSchema) {}
