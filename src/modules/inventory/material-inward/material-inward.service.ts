import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { BusinessException, NotFoundException } from '@/common/exceptions/business.exception';
import { parseBigIntId, serialize } from '@/common/utils/bigint.util';
import {
  AddCaseLinesDto,
  CompleteQcDto,
  ConfirmPutawayDto,
  CreateLocationDto,
  CreatePurchaseOrderDto,
  CreateReturnDto,
  ExcessDecisionDto,
  InvoiceMatchDto,
  SaveGrnDto,
  ShortCloseDto,
} from './dto/material-inward.dto';

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];
const D = (value: number) => new Prisma.Decimal(value);
const num = (value: Prisma.Decimal | number | null | undefined) => Number(value ?? 0);

const REASONS = [
  ['DAMAGED', 'Damaged'],
  ['WRONG_ITEM', 'Wrong item'],
  ['WRONG_SPEC', 'Wrong specification'],
  ['WRONG_SIZE', 'Wrong size'],
  ['QUALITY_FAIL', 'Quality fail'],
  ['EXPIRED', 'Expired'],
  ['PACKAGING', 'Packaging'],
  ['DOCUMENT', 'Document'],
  ['QUANTITY', 'Quantity'],
  ['OTHER', 'Other'],
] as const;

const RESOLUTIONS = [
  ['REPLACEMENT', 'Replacement', false, true],
  ['RETURN', 'Return to supplier', true, false],
  ['DEBIT_CREDIT', 'Debit / credit', false, false],
  ['REWORK', 'Rework', false, true],
  ['USE_AS_IS', 'Use as is', true, false],
  ['SCRAP', 'Scrap', true, false],
  ['PENDING', 'Pending', false, false],
  ['OTHER', 'Other', false, false],
] as const;

@Injectable()
export class MaterialInwardService {
  constructor(private readonly prisma: PrismaService) {}

  private fail(message: string, code: string, status = HttpStatus.BAD_REQUEST): never {
    throw new BusinessException(message, status, undefined, code);
  }

  private async nextNo(tx: Tx, companyId: bigint, prefix: string, count: () => Promise<number>) {
    const n = (await count()) + 1;
    return `${prefix}-${String(n).padStart(6, '0')}`;
  }

  private async log(
    tx: Tx,
    companyId: bigint,
    docType: string,
    docId: bigint,
    actorId: string,
    text: string,
    fromStatus: string | null,
    toStatus: string,
  ) {
    const actor = parseBigIntId(actorId);
    await tx.miActivity.create({
      data: { companyId, docType, docId, actorId: actor, eventText: text },
    });
    await tx.miStatusLog.create({
      data: { companyId, docType, docId, actorId: actor, fromStatus, toStatus },
    });
  }

  private async task(
    tx: Tx,
    companyId: bigint,
    taskType: string,
    roleCode: string,
    docType: string,
    docId: bigint,
    title: string,
  ) {
    await tx.miTask.create({
      data: { companyId, taskType, roleCode, docType, docId, title, status: 'OPEN' },
    });
  }

  private async closeTasks(tx: Tx, companyId: bigint, docType: string, docId: bigint) {
    await tx.miTask.updateMany({
      where: { companyId, docType, docId, status: 'OPEN' },
      data: { status: 'DONE' },
    });
  }

  private async location(
    tx: Tx,
    companyId: bigint,
    warehouseId: bigint,
    kind: 'dock' | 'quarantine',
    actorId: string,
  ) {
    const where =
      kind === 'dock'
        ? { companyId, warehouseId, isReceivingDock: true }
        : { companyId, warehouseId, isQuarantine: true };
    const found = await tx.miStorageLocation.findFirst({ where });
    if (found) return found;
    return tx.miStorageLocation.create({
      data: {
        companyId,
        warehouseId,
        locationType: kind === 'dock' ? 'DOCK' : 'BIN',
        locationCode: kind === 'dock' ? 'DOCK' : 'QUARANTINE',
        locationName: kind === 'dock' ? 'Receiving dock' : 'Quarantine',
        isReceivingDock: kind === 'dock',
        isQuarantine: kind === 'quarantine',
        createdBy: parseBigIntId(actorId),
      },
    });
  }

  private async post(
    tx: Tx,
    params: {
      companyId: bigint;
      actorId: string;
      txnType: string;
      docType: string;
      docId: bigint;
      docLineId?: bigint;
      itemId: bigint;
      warehouseId: bigint;
      locationId: bigint;
      stockStatus: string;
      qtyIn?: number;
      qtyOut?: number;
      uomCode: string;
      refDocType?: string;
      refDocId?: bigint;
    },
  ) {
    const qtyIn = params.qtyIn ?? 0;
    const qtyOut = params.qtyOut ?? 0;
    await this.assertPeriodOpen(tx, params.companyId);
    const count = await tx.miInvLedger.count({ where: { companyId: params.companyId } });
    await tx.miInvLedger.create({
      data: {
        companyId: params.companyId,
        txnNo: `LED-${String(count + 1).padStart(6, '0')}`,
        txnType: params.txnType,
        docType: params.docType,
        docId: params.docId,
        docLineId: params.docLineId,
        itemId: params.itemId,
        warehouseId: params.warehouseId,
        locationId: params.locationId,
        stockStatus: params.stockStatus,
        qtyIn: D(qtyIn),
        qtyOut: D(qtyOut),
        uomCode: params.uomCode,
        txnDate: new Date(),
        refDocType: params.refDocType,
        refDocId: params.refDocId,
        createdBy: parseBigIntId(params.actorId),
      },
    });
    const key = {
      companyId: params.companyId,
      itemId: params.itemId,
      warehouseId: params.warehouseId,
      locationId: params.locationId,
      batchNo: '',
      serialNo: '',
      stockStatus: params.stockStatus,
    };
    const balance = await tx.miInvBalance.findUnique({
      where: { companyId_itemId_warehouseId_locationId_batchNo_serialNo_stockStatus: key },
    });
    const next = num(balance?.onHandQty) + qtyIn - qtyOut;
    if (next < -0.0001) this.fail('Quantity is not in the expected stock status', 'STOCK_STATUS_EMPTY');
    if (balance) {
      await tx.miInvBalance.update({
        where: { id: balance.id },
        data: { onHandQty: D(next), updatedAt: new Date() },
      });
    } else {
      await tx.miInvBalance.create({
        data: { ...key, onHandQty: D(next), uomCode: params.uomCode, updatedAt: new Date() },
      });
    }
  }

  private async ensureLookups(companyId: string) {
    const company = parseBigIntId(companyId);
    const existing = await this.prisma.miRejectionReason.count({ where: { companyId: company } });
    if (existing === 0) {
      await this.prisma.miRejectionReason.createMany({
        data: REASONS.map(([reasonCode, reasonName]) => ({ companyId: company, reasonCode, reasonName })),
      });
      await this.prisma.miResolutionType.createMany({
        data: RESOLUTIONS.map(([resolutionCode, resolutionName, affectsStock, requiresQc]) => ({
          companyId: company,
          resolutionCode,
          resolutionName,
          affectsStock,
          requiresQc,
        })),
      });
    }
    const controls = await this.prisma.miCfgTolerance.count({ where: { companyId: company } });
    if (controls > 0) return;
    const now = new Date();
    await this.prisma.miCfgTolerance.create({
      data: { companyId: company, scopeType: 'COMPANY', scopeId: 0n, overReceiptPct: D(2), priceVariancePct: D(0), taxVariancePct: D(0) },
    });
    await this.prisma.miCfgNotifyRule.createMany({
      data: [
        { companyId: company, eventCode: 'QC_PENDING', thresholdHours: 24, escalateToRole: 'QC_SUPERVISOR' },
        { companyId: company, eventCode: 'SUPPLIER_RESPONSE', thresholdHours: 48, escalateToRole: 'PURCHASE_MANAGER' },
        { companyId: company, eventCode: 'REPLACEMENT_OVERDUE', thresholdHours: 72, escalateToRole: 'BUYER' },
      ],
    });
    await this.prisma.miCfgPeriod.create({
      data: { companyId: company, periodYear: now.getFullYear(), periodMonth: now.getMonth() + 1, inventoryStatus: 'OPEN' },
    });
    await this.prisma.miCfgMatchPolicy.create({ data: { companyId: company, matchQtyBasis: 'ACCEPTED' } });
    await this.prisma.miCfgNumberSeries.createMany({
      data: ['GRN', 'QC', 'CASE', 'RET', 'PAW', 'LEDGER'].map((docType) => ({
        companyId: company, docType, prefix: `${docType}-`, nextNumber: 1, padding: 6,
      })),
    });
    await this.prisma.miUomConversion.create({
      data: { companyId: company, fromUomCode: 'BOX', toUomCode: 'PCS', factor: D(12) },
    });
    await this.prisma.miQcTemplate.create({
      data: {
        companyId: company,
        templateCode: 'VISUAL',
        templateName: 'Visual inspection',
        sampleRule: 'FULL',
        lines: { create: [{ checkCode: 'VISUAL', specText: 'No damage', resultType: 'PASS_FAIL', mandatory: false, sequenceNo: 10 }] },
      },
    });
    const roleActions: Record<string, Array<[string, string]>> = {
      ENTRY_CHECKER: [['GRN', 'CREATE'], ['GRN', 'SUBMIT']],
      QC: [['QC', 'INSPECT']],
      QC_SUPERVISOR: [['QC', 'INSPECT']],
      BUYER: [['CASE', 'RESOLVE'], ['GRN', 'APPROVE_EXCESS'], ['GRN', 'SHORT_CLOSE']],
      STOREKEEPER: [['PUTAWAY', 'PUTAWAY']],
      FINANCE: [['INVOICE', 'MATCH']],
      PURCHASE_MANAGER: [['GRN', 'REVERSE'], ['CONFIG', 'POST_CLOSED']],
      ADMIN: [['GRN', 'CREATE'], ['GRN', 'SUBMIT'], ['GRN', 'REVERSE'], ['QC', 'INSPECT'], ['CASE', 'RESOLVE'], ['PUTAWAY', 'PUTAWAY'], ['INVOICE', 'MATCH'], ['CONFIG', 'POST_CLOSED']],
    };
    for (const [roleCode, actions] of Object.entries(roleActions)) {
      await this.prisma.miSecRole.create({
        data: {
          companyId: company,
          roleCode,
          roleName: roleCode.replaceAll('_', ' '),
          actions: { create: actions.map(([moduleCode, actionCode]) => ({ moduleCode, actionCode })) },
        },
      });
    }
  }

  private async tolerancePct(tx: Tx, companyId: bigint, itemId: bigint, supplierId: bigint) {
    const limits = await this.toleranceLimits(tx, companyId, itemId, supplierId);
    return limits.over;
  }

  private async toleranceLimits(tx: Tx, companyId: bigint, itemId: bigint | null, supplierId: bigint | null) {
    const rows = await tx.miCfgTolerance.findMany({ where: { companyId } });
    const pick = (scopeType: string, scopeId: bigint) => rows.find((row) => row.scopeType === scopeType && row.scopeId === scopeId);
    const chosen = (itemId && pick('ITEM', itemId))
      || (supplierId && pick('SUPPLIER', supplierId))
      || pick('COMPANY', 0n);
    return {
      over: num(chosen?.overReceiptPct),
      price: num(chosen?.priceVariancePct),
      tax: num(chosen?.taxVariancePct),
    };
  }

  private async conversionFactor(tx: Tx, companyId: bigint, itemId: bigint, fromUom: string, toUom: string) {
    if (fromUom === toUom) return 1;
    const specific = await tx.miUomConversion.findFirst({
      where: { companyId, itemId, fromUomCode: fromUom, toUomCode: toUom, active: true },
    });
    const general = specific || await tx.miUomConversion.findFirst({
      where: { companyId, itemId: null, fromUomCode: fromUom, toUomCode: toUom, active: true },
    });
    return general ? num(general.factor) : 1;
  }

  private async assertPeriodOpen(tx: Tx, companyId: bigint) {
    const now = new Date();
    const period = await tx.miCfgPeriod.findUnique({
      where: {
        companyId_periodYear_periodMonth: {
          companyId,
          periodYear: now.getFullYear(),
          periodMonth: now.getMonth() + 1,
        },
      },
    });
    if (period?.inventoryStatus === 'CLOSED') this.fail('Inventory period is closed', 'PERIOD_CLOSED');
  }

  private async escalate(companyId: bigint) {
    const rules = await this.prisma.miCfgNotifyRule.findMany({ where: { companyId, active: true } });
    const byEvent = new Map(rules.map((rule) => [rule.eventCode, rule]));
    const open = await this.prisma.miTask.findMany({ where: { companyId, status: 'OPEN', escalated: false } });
    const now = Date.now();
    for (const task of open) {
      const event = task.taskType === 'QC_INSPECT' ? 'QC_PENDING' : task.taskType === 'SUPPLIER_CASE' ? 'SUPPLIER_RESPONSE' : null;
      const rule = event ? byEvent.get(event) : undefined;
      if (!rule) continue;
      const ageHours = (now - task.createdAt.getTime()) / 36e5;
      if (ageHours < rule.thresholdHours) continue;
      await this.prisma.miTask.update({
        where: { id: task.id },
        data: { escalated: true, escalatedAt: new Date() },
      });
      await this.prisma.miNotification.create({
        data: {
          companyId,
          roleCode: rule.escalateToRole,
          taskId: task.id,
          title: `Escalated: ${task.title}`,
          body: `${task.title} is still open after ${rule.thresholdHours} hours`,
        },
      });
    }
  }

  async reasons(companyId: string) {
    await this.ensureLookups(companyId);
    return serialize(await this.prisma.miRejectionReason.findMany({
      where: { companyId: parseBigIntId(companyId), active: true },
      orderBy: { reasonCode: 'asc' },
    }));
  }

  async resolutions(companyId: string) {
    await this.ensureLookups(companyId);
    return serialize(await this.prisma.miResolutionType.findMany({
      where: { companyId: parseBigIntId(companyId), active: true },
      orderBy: { resolutionCode: 'asc' },
    }));
  }

  async listLocations(companyId: string, warehouseId?: string) {
    return serialize(await this.prisma.miStorageLocation.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        ...(warehouseId ? { warehouseId: parseBigIntId(warehouseId) } : {}),
      },
      orderBy: { locationCode: 'asc' },
    }));
  }

  async createLocation(companyId: string, dto: CreateLocationDto, actorId: string) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { warehouseId: parseBigIntId(dto.warehouseId), companyId: parseBigIntId(companyId), deletedAt: null },
    });
    if (!warehouse) throw new NotFoundException('Warehouse');
    const row = await this.prisma.miStorageLocation.create({
      data: {
        companyId: parseBigIntId(companyId),
        warehouseId: warehouse.warehouseId,
        locationType: dto.locationType,
        locationCode: dto.locationCode,
        locationName: dto.locationName,
        isReceivingDock: dto.isReceivingDock ?? false,
        isQuarantine: dto.isQuarantine ?? false,
        isScrap: dto.isScrap ?? false,
        barcode: dto.barcode,
        createdBy: parseBigIntId(actorId),
      },
    });
    return serialize(row);
  }

  async createPurchaseOrder(companyId: string, dto: CreatePurchaseOrderDto, actorId: string) {
    const company = parseBigIntId(companyId);
    const supplier = await this.prisma.vendor.findFirst({
      where: { vendorId: parseBigIntId(dto.supplierId), companyId: company, deletedAt: null },
    });
    if (!supplier) throw new NotFoundException('Vendor');
    const po = await this.prisma.$transaction(async (tx) => {
      const count = await tx.miPurchaseOrder.count({ where: { companyId: company } });
      const created = await tx.miPurchaseOrder.create({
        data: {
          companyId: company,
          poNo: dto.poNo?.trim() || `PO-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`,
          poDate: new Date(dto.poDate),
          supplierId: supplier.vendorId,
          buyerId: dto.buyerId ? parseBigIntId(dto.buyerId) : parseBigIntId(actorId),
          remarks: dto.remarks,
          createdBy: parseBigIntId(actorId),
          lines: {
            create: dto.lines.map((line, index) => ({
              companyId: company,
              lineNo: (index + 1) * 10,
              itemId: parseBigIntId(line.itemId),
              warehouseId: parseBigIntId(line.warehouseId),
              orderQty: D(line.orderQty),
              outstandingQty: D(line.orderQty),
              uomCode: line.uomCode || 'PCS',
              stockUomCode: line.stockUomCode || 'PCS',
              conversionFactor: D(line.conversionFactor ?? 1),
              unitPrice: D(line.unitPrice ?? 0),
              taxPct: D(line.taxPct ?? 0),
              qcRequired: line.qcRequired ?? true,
              batchControlled: line.batchControlled ?? false,
              serialControlled: line.serialControlled ?? false,
            })),
          },
        },
        include: { lines: true },
      });
      return created;
    });
    return this.getPurchaseOrder(companyId, po.id.toString());
  }

  async listPurchaseOrders(companyId: string, outstandingOnly?: string, poNo?: string) {
    const rows = await this.prisma.miPurchaseOrder.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        poType: 'MATERIAL',
        ...(poNo ? { poNo: { contains: poNo, mode: 'insensitive' } } : {}),
        ...(outstandingOnly === 'true'
          ? { lines: { some: { outstandingQty: { gt: 0 }, lineStatus: { not: 'CLOSED' } } } }
          : {}),
      },
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
    });
    return serialize(rows);
  }

  async getPurchaseOrder(companyId: string, id: string) {
    const po = await this.prisma.miPurchaseOrder.findFirst({
      where: { id: parseBigIntId(id), companyId: parseBigIntId(companyId) },
      include: { lines: true },
    });
    if (!po) throw new NotFoundException('Purchase order');
    return serialize(po);
  }

  async shortClose(companyId: string, lineId: string, dto: ShortCloseDto, actorId: string) {
    const line = await this.prisma.miPurchaseOrderLine.findFirst({
      where: { id: parseBigIntId(lineId), companyId: parseBigIntId(companyId) },
    });
    if (!line) throw new NotFoundException('Purchase order line');
    if (dto.qty > num(line.outstandingQty) + 0.0001) {
      this.fail('Short-close quantity is above the outstanding quantity', 'SHORT_CLOSE_EXCEEDS_OUTSTANDING');
    }
    const shortClosed = num(line.shortClosedQty) + dto.qty;
    const outstanding = Math.max(0, num(line.orderQty) - num(line.receivedQty) - shortClosed);
    const updated = await this.prisma.miPurchaseOrderLine.update({
      where: { id: line.id },
      data: {
        shortClosedQty: D(shortClosed),
        outstandingQty: D(outstanding),
        lineStatus: outstanding === 0 ? 'CLOSED' : 'PARTIAL',
        updatedAt: new Date(),
      },
    });
    await this.prisma.miActivity.create({
      data: {
        companyId: line.companyId,
        docType: 'PO_LINE',
        docId: line.id,
        actorId: parseBigIntId(actorId),
        eventText: `Short closed ${dto.qty}`,
      },
    });
    return serialize(updated);
  }

  async listGrn(companyId: string, status?: string) {
    return serialize(await this.prisma.miGrnHeader.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        ...(status ? { status } : {}),
      },
      include: { lines: true, po: true },
      orderBy: { createdAt: 'desc' },
    }));
  }

  async getGrn(companyId: string, id: string) {
    const grn = await this.prisma.miGrnHeader.findFirst({
      where: { id: parseBigIntId(id), companyId: parseBigIntId(companyId) },
      include: { lines: { include: { batches: true, serials: true } }, po: true },
    });
    if (!grn) throw new NotFoundException('GRN');
    return serialize(grn);
  }

  async saveGrn(companyId: string, dto: SaveGrnDto, actorId: string, grnId?: string) {
    const company = parseBigIntId(companyId);
    const po = await this.prisma.miPurchaseOrder.findFirst({
      where: { id: parseBigIntId(dto.poId), companyId: company },
      include: { lines: true },
    });
    if (!po) throw new NotFoundException('Purchase order');
    const headerId = await this.prisma.$transaction(async (tx) => {
      let headerId: bigint;
      if (grnId) {
        const existing = await tx.miGrnHeader.findFirst({
          where: { id: parseBigIntId(grnId), companyId: company },
        });
        if (!existing) throw new NotFoundException('GRN');
        if (existing.status !== 'DRAFT') this.fail('Only a draft GRN can be edited', 'GRN_NOT_DRAFT');
        await tx.miGrnLine.deleteMany({ where: { grnId: existing.id } });
        await tx.miGrnHeader.update({
          where: { id: existing.id },
          data: {
            supplierDoNo: dto.supplierDoNo,
            deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
            warehouseId: parseBigIntId(dto.warehouseId),
            packagingCondition: dto.packagingCondition,
            remarks: dto.remarks,
            updatedBy: parseBigIntId(actorId),
            updatedAt: new Date(),
          },
        });
        headerId = existing.id;
      } else {
        const grnNo = await this.nextNo(tx, company, 'GRN', () => tx.miGrnHeader.count({ where: { companyId: company } }));
        const created = await tx.miGrnHeader.create({
          data: {
            companyId: company,
            grnNo,
            receiptType: dto.receiptType || 'NORMAL',
            poId: po.id,
            supplierId: po.supplierId,
            supplierDoNo: dto.supplierDoNo,
            deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
            warehouseId: parseBigIntId(dto.warehouseId),
            packagingCondition: dto.packagingCondition,
            remarks: dto.remarks,
            parentGrnId: dto.parentGrnId ? parseBigIntId(dto.parentGrnId) : null,
            supplierCaseId: dto.supplierCaseId ? parseBigIntId(dto.supplierCaseId) : null,
            supplierCaseLineId: dto.supplierCaseLineId ? parseBigIntId(dto.supplierCaseLineId) : null,
            createdBy: parseBigIntId(actorId),
            receivedBy: parseBigIntId(actorId),
          },
        });
        headerId = created.id;
      }

      for (const [index, line] of dto.lines.entries()) {
        const poLine = po.lines.find((row) => row.id === parseBigIntId(line.poLineId));
        if (!poLine) throw new NotFoundException('Purchase order line');
        const batchQty = (line.batches ?? []).reduce((sum, batch) => sum + batch.qty, 0);
        if (line.batches?.length && Math.abs(batchQty - line.receivedQty) > 0.0001) {
          this.fail('Batch quantities must equal the received quantity', 'BATCH_QTY_MISMATCH');
        }
        if (poLine.serialControlled && (line.serials?.length ?? 0) !== line.receivedQty) {
          this.fail('Serial count must equal the received quantity', 'SERIAL_COUNT_MISMATCH');
        }
        const factor = num(poLine.conversionFactor) !== 1
          ? num(poLine.conversionFactor)
          : await this.conversionFactor(tx, company, poLine.itemId, poLine.uomCode, poLine.stockUomCode);
        const createdLine = await tx.miGrnLine.create({
          data: {
            companyId: company,
            grnId: headerId,
            lineNo: (index + 1) * 10,
            poLineId: poLine.id,
            itemId: poLine.itemId,
            orderQtySnapshot: poLine.orderQty,
            prevReceivedQtySnapshot: poLine.receivedQty,
            outstandingQtySnapshot: poLine.outstandingQty,
            receivedQty: D(line.receivedQty),
            uomCode: poLine.uomCode,
            purchaseUomCode: poLine.uomCode,
            inventoryUomCode: poLine.stockUomCode,
            conversionFactor: D(factor),
            remarks: line.remarks,
          },
        });
        if (line.batches?.length) {
          await tx.miGrnBatch.createMany({
            data: line.batches.map((batch) => ({
              grnLineId: createdLine.id,
              batchNo: batch.batchNo,
              supplierBatchNo: batch.supplierBatchNo,
              qtyInv: D(batch.qty),
              mfgDate: batch.mfgDate ? new Date(batch.mfgDate) : null,
              expiryDate: batch.expiryDate ? new Date(batch.expiryDate) : null,
            })),
          });
        }
        if (line.serials?.length) {
          await tx.miGrnSerial.createMany({
            data: line.serials.map((serialNo) => ({
              companyId: company,
              grnLineId: createdLine.id,
              itemId: poLine.itemId,
              serialNo,
            })),
          });
        }
      }
      return headerId;
    });
    return this.getGrn(companyId, headerId.toString());
  }

  async submitGrn(companyId: string, id: string, actorId: string) {
    const company = parseBigIntId(companyId);
    const savedId = await this.prisma.$transaction(async (tx) => {
      const grn = await tx.miGrnHeader.findFirst({
        where: { id: parseBigIntId(id), companyId: company },
        include: { lines: true },
      });
      if (!grn) throw new NotFoundException('GRN');
      if (grn.status !== 'DRAFT' && grn.status !== 'EXCESS_PENDING') {
        this.fail('GRN cannot be submitted from its current status', 'GRN_NOT_DRAFT');
      }
      const dock = await this.location(tx, company, grn.warehouseId, 'dock', actorId);
      let needsApproval = false;
      let needsQc = false;
      for (const line of grn.lines) {
        const poLine = await tx.miPurchaseOrderLine.findUniqueOrThrow({ where: { id: line.poLineId } });
        const received = num(line.receivedQty);
        const tolerancePct = await this.tolerancePct(tx, company, poLine.itemId, grn.supplierId);
        const allowedThis = Math.max(0, num(poLine.orderQty) * (1 + tolerancePct / 100) - num(poLine.receivedQty));
        const excess = grn.receiptType === 'REPLACEMENT' ? 0 : Math.max(0, received - allowedThis);
        const posted = grn.receiptType === 'REPLACEMENT' ? received : Math.min(received, allowedThis);
        const excessStatus = excess > 0 ? 'PENDING_APPROVAL' : 'NONE';
        if (excess > 0) needsApproval = true;
        if (poLine.qcRequired) needsQc = true;
        await tx.miGrnLine.update({
          where: { id: line.id },
          data: {
            excessQty: D(excess),
            shortQty: D(Math.max(0, num(poLine.outstandingQty) - received)),
            excessStatus,
            tolerancePctApplied: D(tolerancePct),
            receivedQtyInv: D(posted * num(line.conversionFactor)),
          },
        });
        if (posted > 0) {
          await this.post(tx, {
            companyId: company,
            actorId,
            txnType: 'GRN_RECEIPT',
            docType: 'GRN',
            docId: grn.id,
            docLineId: line.id,
            itemId: line.itemId,
            warehouseId: grn.warehouseId,
            locationId: dock.id,
            stockStatus: 'QC_HOLD',
            qtyIn: posted * num(line.conversionFactor),
            uomCode: line.uomCode,
            refDocType: 'PO',
            refDocId: grn.poId,
          });
          if (grn.receiptType === 'NORMAL') {
            const newReceived = num(poLine.receivedQty) + posted;
            const newOutstanding = Math.max(0, num(poLine.orderQty) - newReceived - num(poLine.shortClosedQty));
            await tx.miPurchaseOrderLine.update({
              where: { id: poLine.id },
              data: {
                receivedQty: D(newReceived),
                outstandingQty: D(newOutstanding),
                lineStatus: newOutstanding === 0 ? 'CLOSED' : 'PARTIAL',
                updatedAt: new Date(),
              },
            });
          }
        }
      }
      const nextStatus = needsApproval ? 'EXCESS_PENDING' : needsQc ? 'QC_PENDING' : 'PUTAWAY_PENDING';
      await tx.miGrnHeader.update({
        where: { id: grn.id },
        data: { status: nextStatus, submittedAt: new Date(), updatedAt: new Date(), updatedBy: parseBigIntId(actorId) },
      });
      await this.log(tx, company, 'GRN', grn.id, actorId, `Submitted ${grn.grnNo}`, grn.status, nextStatus);
      if (needsQc) {
        const qcNo = await this.nextNo(tx, company, 'QC', () => tx.miQcInspection.count({ where: { companyId: company } }));
        const qc = await tx.miQcInspection.create({
          data: { companyId: company, qcNo, grnId: grn.id, status: 'PENDING', createdBy: parseBigIntId(actorId) },
        });
        await this.task(tx, company, 'QC_INSPECT', 'QC', 'QC', qc.id, `Inspect ${grn.grnNo}`);
      } else {
        await this.openPutaway(tx, company, grn.id, grn.warehouseId, null, 'QC_ACCEPT', dock.id, actorId);
      }
      return grn.id;
    });
    return this.getGrn(companyId, savedId.toString());
  }

  private async openPutaway(
    tx: Tx,
    companyId: bigint,
    grnId: bigint,
    warehouseId: bigint,
    qcId: bigint | null,
    source: string,
    fromLocationId: bigint,
    actorId: string,
  ) {
    const lines = await tx.miGrnLine.findMany({ where: { grnId } });
    const movable = lines
      .map((line) => {
        const qty = source === 'QC_ACCEPT'
          ? Math.max(0, num(line.acceptedQty) || num(line.receivedQtyInv) - num(line.putawayQty))
          : Math.max(0, num(line.conditionalQty));
        return { line, qty: source === 'QC_ACCEPT' && num(line.acceptedQty) === 0 && num(line.rejectedQty) === 0
          ? Math.max(0, num(line.receivedQtyInv) - num(line.putawayQty))
          : qty };
      })
      .filter((row) => row.qty > 0);
    if (!movable.length) return;
    const taskNo = await this.nextNo(tx, companyId, 'PAW', () => tx.miPutawayTask.count({ where: { companyId } }));
    const lineCreates = [];
    for (const row of movable) {
      const rule = await tx.miItemPutawayRule.findFirst({
        where: { companyId, itemId: row.line.itemId, warehouseId, active: true },
        orderBy: { priority: 'asc' },
      });
      lineCreates.push({
        grnLineId: row.line.id,
        itemId: row.line.itemId,
        qty: D(row.qty),
        fromLocationId,
        suggestedLocationId: rule?.preferredLocationId,
      });
    }
    const task = await tx.miPutawayTask.create({
      data: {
        companyId,
        taskNo,
        grnId,
        qcId,
        warehouseId,
        source,
        lines: { create: lineCreates },
      },
    });
    await this.task(tx, companyId, 'PUTAWAY', 'STOREKEEPER', 'PAW', task.id, `Put away ${taskNo}`);
  }

  async excessDecision(companyId: string, id: string, dto: ExcessDecisionDto, actorId: string) {
    const company = parseBigIntId(companyId);
    const grnId = await this.prisma.$transaction(async (tx) => {
      const grn = await tx.miGrnHeader.findFirst({
        where: { id: parseBigIntId(id), companyId: company },
        include: { lines: true },
      });
      if (!grn) throw new NotFoundException('GRN');
      const dock = await this.location(tx, company, grn.warehouseId, 'dock', actorId);
      for (const line of grn.lines) {
        if (dto.grnLineId && line.id !== parseBigIntId(dto.grnLineId)) continue;
        if (line.excessStatus !== 'PENDING_APPROVAL') continue;
        if (dto.decision === 'REJECT') {
          await tx.miGrnLine.update({
            where: { id: line.id },
            data: { excessStatus: 'REJECTED_EXCESS' },
          });
          continue;
        }
        const extra = num(line.excessQty);
        await tx.miGrnLine.update({
          where: { id: line.id },
          data: {
            excessStatus: 'APPROVED',
            receivedQtyInv: D(num(line.receivedQtyInv) + extra),
          },
        });
        const poLine = await tx.miPurchaseOrderLine.findUniqueOrThrow({ where: { id: line.poLineId } });
        const newReceived = num(poLine.receivedQty) + extra;
        await tx.miPurchaseOrderLine.update({
          where: { id: poLine.id },
          data: {
            receivedQty: D(newReceived),
            outstandingQty: D(Math.max(0, num(poLine.orderQty) - newReceived - num(poLine.shortClosedQty))),
            updatedAt: new Date(),
          },
        });
        await this.post(tx, {
          companyId: company,
          actorId,
          txnType: 'GRN_RECEIPT',
          docType: 'GRN',
          docId: grn.id,
          docLineId: line.id,
          itemId: line.itemId,
          warehouseId: grn.warehouseId,
          locationId: dock.id,
          stockStatus: 'QC_HOLD',
          qtyIn: extra,
          uomCode: line.uomCode,
          refDocType: 'PO',
          refDocId: grn.poId,
        });
      }
      await tx.miGrnHeader.update({
        where: { id: grn.id },
        data: { status: 'QC_PENDING', updatedAt: new Date() },
      });
      await this.log(tx, company, 'GRN', grn.id, actorId, `Excess ${dto.decision}`, 'EXCESS_PENDING', 'QC_PENDING');
      return grn.id;
    });
    return this.getGrn(companyId, grnId.toString());
  }

  async listQc(companyId: string, status?: string) {
    return serialize(await this.prisma.miQcInspection.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        ...(status ? { status: status === 'PENDING' ? { in: ['PENDING', 'IN_PROGRESS'] } : status } : {}),
      },
      orderBy: { createdAt: 'desc' },
    }));
  }

  async startQc(companyId: string, id: string, actorId: string) {
    const qc = await this.prisma.miQcInspection.findFirst({
      where: { id: parseBigIntId(id), companyId: parseBigIntId(companyId) },
    });
    if (!qc) throw new NotFoundException('QC inspection');
    const updated = await this.prisma.miQcInspection.update({
      where: { id: qc.id },
      data: { status: 'IN_PROGRESS', inspectorId: parseBigIntId(actorId), updatedAt: new Date() },
    });
    return serialize(updated);
  }

  async completeQc(companyId: string, id: string, dto: CompleteQcDto, actorId: string) {
    const company = parseBigIntId(companyId);
    return this.prisma.$transaction(async (tx) => {
      const qc = await tx.miQcInspection.findFirst({
        where: { id: parseBigIntId(id), companyId: company },
      });
      if (!qc) throw new NotFoundException('QC inspection');
      if (qc.status === 'COMPLETED') this.fail('Inspection is already completed', 'QC_ALREADY_COMPLETED');
      const grn = await tx.miGrnHeader.findUniqueOrThrow({ where: { id: qc.grnId } });
      const dock = await this.location(tx, company, grn.warehouseId, 'dock', actorId);
      const quarantine = await this.location(tx, company, grn.warehouseId, 'quarantine', actorId);
      let rejectedTotal = 0;
      for (const input of dto.lines) {
        const accepted = input.acceptedQty;
        const rejected = input.rejectedQty;
        const conditional = input.conditionalQty ?? 0;
        if (Math.abs(accepted + rejected + conditional - input.inspectQty) > 0.0001) {
          this.fail('Accepted, rejected, and conditional quantities must equal the inspected quantity', 'QC_QTY_MISMATCH');
        }
        if (rejected > 0 && !input.rejectionReasonCode) {
          this.fail('A rejection reason is required when quantity is rejected', 'REJECTION_REASON_REQUIRED');
        }
        const qcLine = await tx.miQcInspectionLine.create({
          data: {
            qcId: qc.id,
            grnLineId: parseBigIntId(input.grnLineId),
            inspectQty: D(input.inspectQty),
            acceptedQty: D(accepted),
            rejectedQty: D(rejected),
            conditionalQty: D(conditional),
            rejectionReasonCode: input.rejectionReasonCode,
            remarks: input.remarks,
            checks: {
              create: (input.checks ?? []).map((check) => ({
                checkCode: check.checkCode,
                actualValue: check.actualValue,
                result: check.result,
              })),
            },
          },
        });
        const grnLine = await tx.miGrnLine.findUniqueOrThrow({ where: { id: parseBigIntId(input.grnLineId) } });
        await tx.miGrnLine.update({
          where: { id: grnLine.id },
          data: {
            inspectedQty: D(input.inspectQty),
            acceptedQty: D(accepted),
            rejectedQty: D(rejected),
            conditionalQty: D(conditional),
          },
        });
        const poLine = await tx.miPurchaseOrderLine.findUniqueOrThrow({ where: { id: grnLine.poLineId } });
        await tx.miPurchaseOrderLine.update({
          where: { id: poLine.id },
          data: {
            acceptedQty: D(num(poLine.acceptedQty) + accepted),
            rejectedOpenQty: D(num(poLine.rejectedOpenQty) + rejected),
            updatedAt: new Date(),
          },
        });
        if (rejected > 0) {
          rejectedTotal += rejected;
          await this.post(tx, {
            companyId: company, actorId, txnType: 'QC_STATUS_MOVE', docType: 'QC', docId: qc.id, docLineId: qcLine.id,
            itemId: grnLine.itemId, warehouseId: grn.warehouseId, locationId: dock.id, stockStatus: 'QC_HOLD',
            qtyOut: rejected, uomCode: grnLine.uomCode,
          });
          await this.post(tx, {
            companyId: company, actorId, txnType: 'QC_STATUS_MOVE', docType: 'QC', docId: qc.id, docLineId: qcLine.id,
            itemId: grnLine.itemId, warehouseId: grn.warehouseId, locationId: quarantine.id, stockStatus: 'QUARANTINE',
            qtyIn: rejected, uomCode: grnLine.uomCode,
          });
        }
      }
      await tx.miQcInspection.update({
        where: { id: qc.id },
        data: {
          status: 'COMPLETED',
          overallResult: dto.overallResult,
          sampleQty: D(dto.sampleQty ?? 0),
          inspectionDate: new Date(),
          inspectorId: parseBigIntId(actorId),
          updatedAt: new Date(),
        },
      });
      await this.closeTasks(tx, company, 'QC', qc.id);
      await this.log(tx, company, 'QC', qc.id, actorId, `QC ${dto.overallResult}`, qc.status, 'COMPLETED');
      await this.openPutaway(tx, company, grn.id, grn.warehouseId, qc.id, 'QC_ACCEPT', dock.id, actorId);
      if (rejectedTotal > 0) {
        const caseNo = await this.nextNo(tx, company, 'CASE', () => tx.miSupplierCase.count({ where: { companyId: company } }));
        const supplierCase = await tx.miSupplierCase.create({
          data: {
            companyId: company,
            caseNo,
            grnId: grn.id,
            qcId: qc.id,
            poId: grn.poId,
            supplierId: grn.supplierId,
            buyerId: parseBigIntId(actorId),
            dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            createdBy: parseBigIntId(actorId),
          },
        });
        await this.task(tx, company, 'SUPPLIER_CASE', 'BUYER', 'CASE', supplierCase.id, `Resolve ${caseNo}`);
      }
      await tx.miGrnHeader.update({ where: { id: grn.id }, data: { status: 'QC_DONE', updatedAt: new Date() } });
      return serialize(await tx.miQcInspection.findUnique({ where: { id: qc.id }, include: { lines: { include: { checks: true } } } }));
    });
  }

  async listCases(companyId: string) {
    return serialize(await this.prisma.miSupplierCase.findMany({
      where: { companyId: parseBigIntId(companyId) },
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
    }));
  }

  async addCaseLines(companyId: string, id: string, dto: AddCaseLinesDto, actorId: string) {
    const supplierCase = await this.prisma.miSupplierCase.findFirst({
      where: { id: parseBigIntId(id), companyId: parseBigIntId(companyId) },
      include: { lines: true },
    });
    if (!supplierCase) throw new NotFoundException('Supplier case');
    const grnLines = await this.prisma.miGrnLine.findMany({ where: { grnId: supplierCase.grnId } });
    for (const input of dto.lines) {
      const grnLine = grnLines.find((row) => row.id === parseBigIntId(input.grnLineId));
      if (!grnLine) throw new NotFoundException('GRN line');
      const already = supplierCase.lines
        .filter((row) => row.grnLineId === grnLine.id)
        .reduce((sum, row) => sum + num(row.resolutionQty), 0);
      const incoming = dto.lines
        .filter((row) => row.grnLineId === input.grnLineId)
        .reduce((sum, row) => sum + row.resolutionQty, 0);
      if (already + incoming > num(grnLine.rejectedQty) + num(grnLine.conditionalQty) + 0.0001) {
        this.fail('Resolution quantity is above the rejected quantity', 'RESOLUTION_EXCEEDS_REJECTED');
      }
    }
    await this.prisma.miSupplierCaseLine.createMany({
      data: dto.lines.map((line) => ({
        caseId: supplierCase.id,
        grnLineId: parseBigIntId(line.grnLineId),
        rejectionReasonCode: line.rejectionReasonCode,
        rejectedQty: D(num(grnLines.find((row) => row.id === parseBigIntId(line.grnLineId))?.rejectedQty)),
        resolutionType: line.resolutionType,
        resolutionQty: D(line.resolutionQty),
        remainingQty: D(line.resolutionQty),
        remarks: line.remarks,
      })),
    });
    await this.prisma.miActivity.create({
      data: {
        companyId: supplierCase.companyId,
        docType: 'CASE',
        docId: supplierCase.id,
        actorId: parseBigIntId(actorId),
        eventText: 'Resolution split saved',
      },
    });
    return this.listCases(companyId).then((rows) => (rows as unknown as { id: string }[]).find((row) => row.id === id) ?? serialize(supplierCase));
  }

  async useAsIs(companyId: string, caseId: string, lineId: string, actorId: string) {
    const company = parseBigIntId(companyId);
    return this.prisma.$transaction(async (tx) => {
      const line = await tx.miSupplierCaseLine.findFirst({
        where: { id: parseBigIntId(lineId), caseId: parseBigIntId(caseId) },
      });
      if (!line) throw new NotFoundException('Supplier case line');
      const supplierCase = await tx.miSupplierCase.findUniqueOrThrow({ where: { id: line.caseId } });
      const grn = await tx.miGrnHeader.findUniqueOrThrow({ where: { id: supplierCase.grnId } });
      const quarantine = await this.location(tx, company, grn.warehouseId, 'quarantine', actorId);
      const grnLine = await tx.miGrnLine.findUniqueOrThrow({ where: { id: line.grnLineId } });
      const taskNo = await this.nextNo(tx, company, 'PAW', () => tx.miPutawayTask.count({ where: { companyId: company } }));
      const task = await tx.miPutawayTask.create({
        data: {
          companyId: company,
          taskNo,
          grnId: grn.id,
          warehouseId: grn.warehouseId,
          source: 'CONDITIONAL',
          lines: {
            create: [{
              grnLineId: grnLine.id,
              itemId: grnLine.itemId,
              qty: line.remainingQty,
              fromLocationId: quarantine.id,
            }],
          },
        },
      });
      await tx.miSupplierCaseLine.update({
        where: { id: line.id },
        data: { resolutionType: 'USE_AS_IS', status: 'PARTIAL' },
      });
      await this.task(tx, company, 'PUTAWAY', 'STOREKEEPER', 'PAW', task.id, `Put away use-as-is ${taskNo}`);
      return serialize(task);
    });
  }

  async createReturn(companyId: string, dto: CreateReturnDto, actorId: string) {
    const company = parseBigIntId(companyId);
    const caseLine = await this.prisma.miSupplierCaseLine.findFirst({
      where: { id: parseBigIntId(dto.caseLineId) },
    });
    if (!caseLine) throw new NotFoundException('Supplier case line');
    if (dto.qty > num(caseLine.remainingQty) + 0.0001) {
      this.fail('Return quantity is above the remaining resolution quantity', 'RESOLUTION_EXCEEDS_REJECTED');
    }
    const supplierCase = await this.prisma.miSupplierCase.findUniqueOrThrow({ where: { id: caseLine.caseId } });
    const grnLine = await this.prisma.miGrnLine.findUniqueOrThrow({ where: { id: caseLine.grnLineId } });
    const grn = await this.prisma.miGrnHeader.findUniqueOrThrow({ where: { id: supplierCase.grnId } });
    const quarantine = await this.prisma.$transaction((tx) => this.location(tx, company, grn.warehouseId, 'quarantine', actorId));
    const created = await this.prisma.$transaction(async (tx) => {
      const returnNo = await this.nextNo(tx, company, 'RET', () => tx.miReturnHeader.count({ where: { companyId: company } }));
      return tx.miReturnHeader.create({
        data: {
          companyId: company,
          returnNo,
          caseId: supplierCase.id,
          caseLineId: caseLine.id,
          grnId: grn.id,
          supplierId: supplierCase.supplierId,
          returnDate: dto.returnDate ? new Date(dto.returnDate) : new Date(),
          createdBy: parseBigIntId(actorId),
          lines: {
            create: [{
              itemId: grnLine.itemId,
              grnLineId: grnLine.id,
              locationId: quarantine.id,
              qty: D(dto.qty),
              uomCode: grnLine.uomCode,
            }],
          },
        },
        include: { lines: true },
      });
    });
    return serialize(created);
  }

  async postReturn(companyId: string, id: string, actorId: string) {
    const company = parseBigIntId(companyId);
    return this.prisma.$transaction(async (tx) => {
      const header = await tx.miReturnHeader.findFirst({
        where: { id: parseBigIntId(id), companyId: company },
        include: { lines: true },
      });
      if (!header) throw new NotFoundException('Return');
      if (header.status === 'POSTED') this.fail('Return is already posted', 'RETURN_ALREADY_POSTED');
      const grn = await tx.miGrnHeader.findUniqueOrThrow({ where: { id: header.grnId } });
      for (const line of header.lines) {
        await this.post(tx, {
          companyId: company, actorId, txnType: 'SUPPLIER_RETURN', docType: 'RET', docId: header.id, docLineId: line.id,
          itemId: line.itemId, warehouseId: grn.warehouseId, locationId: line.locationId, stockStatus: 'QUARANTINE',
          qtyOut: num(line.qty), uomCode: line.uomCode, refDocType: 'GRN', refDocId: grn.id,
        });
        const grnLine = await tx.miGrnLine.findUniqueOrThrow({ where: { id: line.grnLineId } });
        await tx.miGrnLine.update({
          where: { id: grnLine.id },
          data: { returnedQty: D(num(grnLine.returnedQty) + num(line.qty)) },
        });
      }
      const caseLine = await tx.miSupplierCaseLine.findUniqueOrThrow({ where: { id: header.caseLineId } });
      const qty = header.lines.reduce((sum, line) => sum + num(line.qty), 0);
      const resolved = num(caseLine.resolvedQty) + qty;
      const remaining = Math.max(0, num(caseLine.resolutionQty) - resolved);
      await tx.miSupplierCaseLine.update({
        where: { id: caseLine.id },
        data: { resolvedQty: D(resolved), remainingQty: D(remaining), status: remaining === 0 ? 'DONE' : 'PARTIAL' },
      });
      await tx.miReturnHeader.update({
        where: { id: header.id },
        data: { status: 'POSTED', postedAt: new Date() },
      });
      await this.log(tx, company, 'RET', header.id, actorId, `Posted ${header.returnNo}`, 'DRAFT', 'POSTED');
      return serialize(header);
    });
  }

  async listPutaway(companyId: string, status?: string) {
    return serialize(await this.prisma.miPutawayTask.findMany({
      where: { companyId: parseBigIntId(companyId), ...(status ? { status } : {}) },
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
    }));
  }

  async confirmPutaway(companyId: string, id: string, dto: ConfirmPutawayDto, actorId: string) {
    const company = parseBigIntId(companyId);
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.miPutawayTask.findFirst({
        where: { id: parseBigIntId(id), companyId: company },
        include: { lines: true },
      });
      if (!task) throw new NotFoundException('Put-away task');
      const stockStatus = task.source === 'CONDITIONAL' ? 'QUARANTINE' : 'QC_HOLD';
      for (const input of dto.lines) {
        const line = task.lines.find((row) => row.id === parseBigIntId(input.putawayLineId));
        if (!line) throw new NotFoundException('Put-away line');
        const grnLine = await tx.miGrnLine.findUniqueOrThrow({ where: { id: line.grnLineId } });
        const grn = await tx.miGrnHeader.findUniqueOrThrow({ where: { id: task.grnId } });
        await this.post(tx, {
          companyId: company, actorId, txnType: 'PUTAWAY', docType: 'PAW', docId: task.id, docLineId: line.id,
          itemId: line.itemId, warehouseId: task.warehouseId, locationId: line.fromLocationId, stockStatus,
          qtyOut: num(line.qty), uomCode: grnLine.uomCode,
        });
        await this.post(tx, {
          companyId: company, actorId, txnType: 'PUTAWAY', docType: 'PAW', docId: task.id, docLineId: line.id,
          itemId: line.itemId, warehouseId: task.warehouseId, locationId: parseBigIntId(input.confirmedLocationId),
          stockStatus: 'AVAILABLE', qtyIn: num(line.qty), uomCode: grnLine.uomCode, refDocType: 'GRN', refDocId: grn.id,
        });
        await tx.miPutawayLine.update({
          where: { id: line.id },
          data: {
            confirmedLocationId: parseBigIntId(input.confirmedLocationId),
            putawayBy: parseBigIntId(actorId),
            putawayAt: new Date(),
          },
        });
        await tx.miGrnLine.update({
          where: { id: grnLine.id },
          data: { putawayQty: D(num(grnLine.putawayQty) + num(line.qty)) },
        });
      }
      await tx.miPutawayTask.update({
        where: { id: task.id },
        data: { status: 'DONE', updatedAt: new Date() },
      });
      await this.closeTasks(tx, company, 'PAW', task.id);
      await this.log(tx, company, 'PAW', task.id, actorId, `Confirmed ${task.taskNo}`, task.status, 'DONE');
      return serialize(await tx.miPutawayTask.findUnique({ where: { id: task.id }, include: { lines: true } }));
    });
  }

  async balances(companyId: string, itemId?: string, status?: string) {
    return serialize(await this.prisma.miInvBalance.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        ...(itemId ? { itemId: parseBigIntId(itemId) } : {}),
        ...(status ? { stockStatus: status } : {}),
      },
      orderBy: { id: 'desc' },
    }));
  }

  async ledger(companyId: string, itemId?: string) {
    return serialize(await this.prisma.miInvLedger.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        ...(itemId ? { itemId: parseBigIntId(itemId) } : {}),
      },
      orderBy: { id: 'asc' },
    }));
  }

  async tasks(companyId: string, actorId?: string) {
    const company = parseBigIntId(companyId);
    await this.ensureLookups(companyId);
    await this.escalate(company);
    const rows = await this.prisma.miTask.findMany({
      where: {
        companyId: company,
        status: 'OPEN',
        ...(actorId
          ? { OR: [{ assigneeId: null }, { assigneeId: parseBigIntId(actorId) }] }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    const counts = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.roleCode] = (acc[row.roleCode] ?? 0) + 1;
      return acc;
    }, {});
    return serialize({ counts, items: rows });
  }

  async activity(companyId: string, docType: string, id: string) {
    return serialize(await this.prisma.miActivity.findMany({
      where: { companyId: parseBigIntId(companyId), docType, docId: parseBigIntId(id) },
      orderBy: { eventTime: 'asc' },
    }));
  }

  async trace(companyId: string, docType: string, id: string) {
    const company = parseBigIntId(companyId);
    const key = docType.toUpperCase();
    let grnId: bigint | null = null;
    if (key === 'GRN') grnId = parseBigIntId(id);
    if (key === 'QC') {
      const qc = await this.prisma.miQcInspection.findFirst({ where: { id: parseBigIntId(id), companyId: company } });
      grnId = qc?.grnId ?? null;
    }
    if (key === 'CASE') {
      const row = await this.prisma.miSupplierCase.findFirst({ where: { id: parseBigIntId(id), companyId: company } });
      grnId = row?.grnId ?? null;
    }
    if (key === 'PAW') {
      const row = await this.prisma.miPutawayTask.findFirst({ where: { id: parseBigIntId(id), companyId: company } });
      grnId = row?.grnId ?? null;
    }
    if (key === 'RET') {
      const row = await this.prisma.miReturnHeader.findFirst({ where: { id: parseBigIntId(id), companyId: company } });
      grnId = row?.grnId ?? null;
    }
    if (!grnId) throw new NotFoundException('Document');
    const grn = await this.prisma.miGrnHeader.findFirst({
      where: { id: grnId, companyId: company },
      include: { po: { include: { lines: true } }, lines: true },
    });
    if (!grn) throw new NotFoundException('GRN');
    const [qc, cases, putaway, returns, activity] = await Promise.all([
      this.prisma.miQcInspection.findMany({ where: { companyId: company, grnId }, include: { lines: true } }),
      this.prisma.miSupplierCase.findMany({ where: { companyId: company, grnId }, include: { lines: true } }),
      this.prisma.miPutawayTask.findMany({ where: { companyId: company, grnId }, include: { lines: true } }),
      this.prisma.miReturnHeader.findMany({ where: { companyId: company, grnId }, include: { lines: true } }),
      this.prisma.miActivity.findMany({ where: { companyId: company, docType: 'GRN', docId: grnId } }),
    ]);
    return serialize({ grn, qc, cases, putaway, returns, activity });
  }

  async uninvoiced(companyId: string) {
    const lines = await this.prisma.miGrnLine.findMany({
      where: { companyId: parseBigIntId(companyId), acceptedQty: { gt: 0 } },
    });
    const matches = await this.prisma.miApMatch.findMany({
      where: { companyId: parseBigIntId(companyId), grnLineId: { not: null } },
    });
    const matched = new Map<string, number>();
    for (const row of matches) {
      const key = row.grnLineId?.toString() ?? '';
      matched.set(key, (matched.get(key) ?? 0) + num(row.matchedQty));
    }
    const open = lines
      .map((line) => ({
        ...line,
        matchedQty: matched.get(line.id.toString()) ?? 0,
        uninvoicedQty: num(line.acceptedQty) - (matched.get(line.id.toString()) ?? 0),
      }))
      .filter((line) => line.uninvoicedQty > 0.0001);
    return serialize(open);
  }

  async matchInvoice(companyId: string, dto: InvoiceMatchDto, actorId: string) {
    const company = parseBigIntId(companyId);
    const invoice = await this.prisma.$transaction(async (tx) => {
      let total = 0;
      let variance = false;
      const header = await tx.miApInvoice.create({
        data: {
          companyId: company,
          invoiceNo: dto.invoiceNo,
          invoiceDate: new Date(dto.invoiceDate),
          supplierId: parseBigIntId(dto.supplierId),
          poId: dto.poId ? parseBigIntId(dto.poId) : null,
          currencyCode: dto.currencyCode || 'SGD',
          createdBy: parseBigIntId(actorId),
        },
      });
      for (const input of dto.lines) {
        const grnLine = await tx.miGrnLine.findFirst({
          where: { id: parseBigIntId(input.grnLineId), companyId: company },
        });
        if (!grnLine) throw new NotFoundException('GRN line');
        const poLine = await tx.miPurchaseOrderLine.findUniqueOrThrow({ where: { id: grnLine.poLineId } });
        const matchedSoFar = await tx.miApMatch.aggregate({
          where: { grnLineId: grnLine.id },
          _sum: { matchedQty: true },
        });
        const policy = await tx.miCfgMatchPolicy.findUnique({ where: { companyId: company } });
        const basis = policy?.matchQtyBasis || 'ACCEPTED';
        const basisQty = basis === 'RECEIVED'
          ? num(grnLine.receivedQtyInv)
          : basis === 'PUTAWAY'
            ? num(grnLine.putawayQty)
            : num(grnLine.acceptedQty);
        const openQty = basisQty - num(matchedSoFar._sum.matchedQty);
        const limits = await this.toleranceLimits(tx, company, grnLine.itemId, null);
        const priceVariance = input.unitPrice - num(poLine.unitPrice);
        const taxVariance = (input.taxPct ?? 0) - num(poLine.taxPct);
        const qtyVariance = input.qty - openQty;
        let matchStatus = 'MATCHED';
        if (Math.abs(priceVariance) > limits.price + 0.0001) matchStatus = 'PRICE_DIFF';
        if (Math.abs(taxVariance) > limits.tax + 0.0001) matchStatus = 'TAX_DIFF';
        if (input.qty > openQty + 0.0001) matchStatus = 'QTY_DIFF';
        if (matchStatus !== 'MATCHED') variance = true;
        total += input.qty * input.unitPrice;
        const invoiceLine = await tx.miApInvoiceLine.create({
          data: {
            invoiceId: header.id,
            itemId: grnLine.itemId,
            poLineId: poLine.id,
            grnLineId: grnLine.id,
            qty: D(input.qty),
            unitPrice: D(input.unitPrice),
            taxPct: D(input.taxPct ?? 0),
          },
        });
        await tx.miApMatch.create({
          data: {
            companyId: company,
            invoiceLineId: invoiceLine.id,
            poLineId: poLine.id,
            grnLineId: grnLine.id,
            matchedQty: D(input.qty),
            poPrice: poLine.unitPrice,
            invoicePrice: D(input.unitPrice),
            priceVariance: D(priceVariance),
            qtyVariance: D(qtyVariance),
            taxVariance: D(taxVariance),
            matchStatus,
          },
        });
        await tx.miPurchaseOrderLine.update({
          where: { id: poLine.id },
          data: { invoicedQty: D(num(poLine.invoicedQty) + input.qty), updatedAt: new Date() },
        });
      }
      return tx.miApInvoice.update({
        where: { id: header.id },
        data: { totalAmount: D(total), status: variance ? 'VARIANCE' : 'MATCHED' },
        include: { lines: { include: { matches: true } } },
      });
    });
    return serialize(invoice);
  }

  async reverseGrn(companyId: string, id: string, actorId: string) {
    const company = parseBigIntId(companyId);
    const savedId = await this.prisma.$transaction(async (tx) => {
      const grn = await tx.miGrnHeader.findFirst({
        where: { id: parseBigIntId(id), companyId: company },
        include: { lines: true },
      });
      if (!grn) throw new NotFoundException('GRN');
      if (grn.status === 'DRAFT') this.fail('A draft GRN is deleted by editing, not reversed', 'GRN_NOT_POSTED');
      if (grn.status === 'REVERSED') this.fail('This GRN is already reversed', 'GRN_ALREADY_REVERSED');
      const qcDone = await tx.miQcInspection.count({ where: { grnId: grn.id, status: 'COMPLETED' } });
      const putaway = await tx.miPutawayTask.count({ where: { grnId: grn.id, status: 'DONE' } });
      if (qcDone || putaway) this.fail('Reverse the later QC or put-away before reversing this GRN', 'GRN_HAS_DOWNSTREAM');
      const movements = await tx.miInvLedger.findMany({ where: { companyId: company, docType: 'GRN', docId: grn.id } });
      for (const move of movements) {
        await this.post(tx, {
          companyId: company,
          actorId,
          txnType: 'GRN_REVERSAL',
          docType: 'GRN',
          docId: grn.id,
          docLineId: move.docLineId ?? undefined,
          itemId: move.itemId,
          warehouseId: move.warehouseId,
          locationId: move.locationId,
          stockStatus: move.stockStatus,
          qtyIn: num(move.qtyOut),
          qtyOut: num(move.qtyIn),
          uomCode: move.uomCode,
          refDocType: 'GRN',
          refDocId: grn.id,
        });
      }
      if (grn.receiptType === 'NORMAL') {
        for (const line of grn.lines) {
          const poLine = await tx.miPurchaseOrderLine.findUniqueOrThrow({ where: { id: line.poLineId } });
          const postedPurchase = num(line.conversionFactor) > 0 ? num(line.receivedQtyInv) / num(line.conversionFactor) : num(line.receivedQtyInv);
          const newReceived = Math.max(0, num(poLine.receivedQty) - postedPurchase);
          const newOutstanding = Math.max(0, num(poLine.orderQty) - newReceived - num(poLine.shortClosedQty));
          await tx.miPurchaseOrderLine.update({
            where: { id: poLine.id },
            data: {
              receivedQty: D(newReceived),
              outstandingQty: D(newOutstanding),
              lineStatus: newOutstanding === 0 ? 'CLOSED' : newReceived === 0 ? 'OPEN' : 'PARTIAL',
              updatedAt: new Date(),
            },
          });
        }
      }
      await tx.miGrnHeader.update({
        where: { id: grn.id },
        data: { status: 'REVERSED', updatedAt: new Date(), updatedBy: parseBigIntId(actorId) },
      });
      await this.closeTasks(tx, company, 'GRN', grn.id);
      await this.closeTasks(tx, company, 'QC', grn.id);
      await this.log(tx, company, 'GRN', grn.id, actorId, `Reversed ${grn.grnNo}`, grn.status, 'REVERSED');
      return grn.id;
    });
    return this.getGrn(companyId, savedId.toString());
  }

  async listAttachments(companyId: string, docType: string, docId: string) {
    return serialize(await this.prisma.miAttachment.findMany({
      where: { companyId: parseBigIntId(companyId), docType: docType.toUpperCase(), docId: parseBigIntId(docId) },
      orderBy: { createdAt: 'asc' },
    }));
  }

  async addAttachment(companyId: string, dto: { docType: string; docId: string; fileName: string; fileUrl: string; mimeType?: string; category?: string }, actorId: string) {
    return serialize(await this.prisma.miAttachment.create({
      data: {
        companyId: parseBigIntId(companyId),
        docType: dto.docType.toUpperCase(),
        docId: parseBigIntId(dto.docId),
        fileName: dto.fileName,
        fileUrl: dto.fileUrl,
        mimeType: dto.mimeType,
        category: dto.category || 'DO',
        uploadedBy: parseBigIntId(actorId),
      },
    }));
  }

  async config(companyId: string) {
    await this.ensureLookups(companyId);
    const company = parseBigIntId(companyId);
    const [tolerances, notifyRules, periods, matchPolicy, roles, conversions, templates, putawayRules] = await Promise.all([
      this.prisma.miCfgTolerance.findMany({ where: { companyId: company } }),
      this.prisma.miCfgNotifyRule.findMany({ where: { companyId: company } }),
      this.prisma.miCfgPeriod.findMany({ where: { companyId: company }, orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }] }),
      this.prisma.miCfgMatchPolicy.findUnique({ where: { companyId: company } }),
      this.prisma.miSecRole.findMany({ where: { companyId: company }, include: { actions: true } }),
      this.prisma.miUomConversion.findMany({ where: { companyId: company, active: true } }),
      this.prisma.miQcTemplate.findMany({ where: { companyId: company }, include: { lines: true } }),
      this.prisma.miItemPutawayRule.findMany({ where: { companyId: company, active: true } }),
    ]);
    return serialize({ tolerances, notifyRules, periods, matchPolicy, roles, conversions, templates, putawayRules });
  }
}
