import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const qty = z.number().positive();

export const CreatePurchaseOrderSchema = z.object({
  poNo: z.string().trim().min(1).max(30).optional(),
  poDate: z.string().trim().min(8),
  supplierId: z.string().trim().min(1),
  buyerId: z.string().trim().optional(),
  remarks: z.string().trim().max(1000).optional(),
  lines: z.array(z.object({
    itemId: z.string().trim().min(1),
    warehouseId: z.string().trim().min(1),
    orderQty: qty,
    uomCode: z.string().trim().max(10).optional(),
    stockUomCode: z.string().trim().max(10).optional(),
    conversionFactor: z.number().positive().optional(),
    unitPrice: z.number().nonnegative().optional(),
    taxPct: z.number().nonnegative().optional(),
    qcRequired: z.boolean().optional(),
    batchControlled: z.boolean().optional(),
    serialControlled: z.boolean().optional(),
  })).min(1),
});

export const ShortCloseSchema = z.object({
  qty: qty,
});

const batchSchema = z.object({
  batchNo: z.string().trim().min(1).max(40),
  supplierBatchNo: z.string().trim().max(40).optional(),
  qty: qty,
  mfgDate: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
});

export const SaveGrnSchema = z.object({
  receiptType: z.enum(['NORMAL', 'REPLACEMENT']).optional(),
  poId: z.string().trim().min(1),
  supplierDoNo: z.string().trim().max(40).optional(),
  deliveryDate: z.string().optional(),
  warehouseId: z.string().trim().min(1),
  packagingCondition: z.enum(['GOOD', 'DAMAGED', 'OPENED', 'WET', 'OTHER']).optional(),
  remarks: z.string().trim().max(1000).optional(),
  parentGrnId: z.string().optional(),
  supplierCaseId: z.string().optional(),
  supplierCaseLineId: z.string().optional(),
  lines: z.array(z.object({
    poLineId: z.string().trim().min(1),
    receivedQty: qty,
    remarks: z.string().trim().max(500).optional(),
    batches: z.array(batchSchema).optional(),
    serials: z.array(z.string().trim().min(1).max(60)).optional(),
  })).min(1),
});

export const ExcessDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  grnLineId: z.string().trim().min(1).optional(),
});

export const CompleteQcSchema = z.object({
  sampleQty: z.number().nonnegative().optional(),
  overallResult: z.enum(['ACCEPT', 'PARTIAL_ACCEPT', 'REJECT', 'CONDITIONAL_ACCEPT']),
  lines: z.array(z.object({
    grnLineId: z.string().trim().min(1),
    inspectQty: qty,
    acceptedQty: z.number().nonnegative(),
    rejectedQty: z.number().nonnegative(),
    conditionalQty: z.number().nonnegative().optional(),
    rejectionReasonCode: z.string().trim().max(30).optional(),
    remarks: z.string().trim().max(1000).optional(),
    checks: z.array(z.object({
      checkCode: z.string().trim().min(1).max(30),
      actualValue: z.string().trim().max(200).optional(),
      result: z.enum(['PASS', 'FAIL', 'NA']),
    })).optional(),
  })).min(1),
});

export const AddCaseLinesSchema = z.object({
  lines: z.array(z.object({
    grnLineId: z.string().trim().min(1),
    resolutionType: z.string().trim().min(1).max(30),
    resolutionQty: qty,
    rejectionReasonCode: z.string().trim().max(30).optional(),
    remarks: z.string().trim().max(1000).optional(),
  })).min(1),
});

export const CreateReturnSchema = z.object({
  caseLineId: z.string().trim().min(1),
  qty: qty,
  returnDate: z.string().optional(),
});

export const ConfirmPutawaySchema = z.object({
  lines: z.array(z.object({
    putawayLineId: z.string().trim().min(1),
    confirmedLocationId: z.string().trim().min(1),
  })).min(1),
});

export const CreateLocationSchema = z.object({
  warehouseId: z.string().trim().min(1),
  locationType: z.enum(['ZONE', 'RACK', 'SHELF', 'BIN', 'DOCK']),
  locationCode: z.string().trim().min(1).max(30),
  locationName: z.string().trim().min(1).max(120),
  isReceivingDock: z.boolean().optional(),
  isQuarantine: z.boolean().optional(),
  isScrap: z.boolean().optional(),
  barcode: z.string().trim().max(80).optional(),
});

export const InvoiceMatchSchema = z.object({
  supplierId: z.string().trim().min(1),
  invoiceNo: z.string().trim().min(1).max(40),
  invoiceDate: z.string().trim().min(8),
  poId: z.string().optional(),
  currencyCode: z.string().trim().max(3).optional(),
  lines: z.array(z.object({
    grnLineId: z.string().trim().min(1),
    qty: qty,
    unitPrice: z.number().nonnegative(),
    taxPct: z.number().nonnegative().optional(),
  })).min(1),
});

export class CreatePurchaseOrderDto extends createZodDto(CreatePurchaseOrderSchema) {}
export class ShortCloseDto extends createZodDto(ShortCloseSchema) {}
export class SaveGrnDto extends createZodDto(SaveGrnSchema) {}
export class ExcessDecisionDto extends createZodDto(ExcessDecisionSchema) {}
export class CompleteQcDto extends createZodDto(CompleteQcSchema) {}
export class AddCaseLinesDto extends createZodDto(AddCaseLinesSchema) {}
export class CreateReturnDto extends createZodDto(CreateReturnSchema) {}
export class ConfirmPutawayDto extends createZodDto(ConfirmPutawaySchema) {}
export class CreateLocationDto extends createZodDto(CreateLocationSchema) {}
export class InvoiceMatchDto extends createZodDto(InvoiceMatchSchema) {}

export const AttachmentSchema = z.object({
  docType: z.string().trim().min(1).max(20),
  docId: z.string().trim().min(1),
  fileName: z.string().trim().min(1).max(255),
  fileUrl: z.string().trim().min(1).max(500),
  mimeType: z.string().trim().max(120).optional(),
  category: z.enum(['DO', 'PACKING', 'QC_REPORT', 'PHOTO', 'EMAIL', 'RETURN_DOC']).optional(),
});
export class AttachmentDto extends createZodDto(AttachmentSchema) {}
