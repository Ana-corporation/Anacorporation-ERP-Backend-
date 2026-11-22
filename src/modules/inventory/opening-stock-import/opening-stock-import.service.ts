import { createHash } from 'crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  OpeningStockImportMatch,
  OpeningStockImportStatus,
  Prisma,
  StockMovementType,
  UserAuditAction,
} from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { BusinessException } from '@/common/exceptions/business.exception';
import { parseBigIntId, serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { ImportSessionService } from '@/modules/imports/import-session.service';
import { InventoryDocumentsService } from '@/modules/inventory/stock/inventory-documents.service';
import {
  OpeningImportApproveDto,
  OpeningImportExcludeDto,
  OpeningImportListQueryDto,
  OpeningImportRowUpdateDto,
  OpeningImportRowsQueryDto,
} from './dto/opening-stock-import.dto';
import {
  OPENING_IMPORT_ALIASES,
  OPENING_IMPORT_APPROVE_TIMEOUT_MS,
  OPENING_IMPORT_CHUNK,
  OPENING_IMPORT_COLUMNS,
  OPENING_IMPORT_ERROR_CODES,
  OPENING_IMPORT_INSTRUCTIONS,
  OPENING_IMPORT_REQUIRED_COLUMNS,
  OPENING_IMPORT_SAMPLE_ROW,
  OPENING_IMPORT_SIMILAR_MAX,
  OPENING_IMPORT_SIMILAR_MIN_SCORE,
  OPENING_IMPORT_UPDATE_CHUNK,
} from './opening-stock-import.constants';
import {
  EvaluatedRow,
  EvaluationContext,
  ImportRowData,
  ImportRowInput,
  ItemInfo,
  PART_NOT_FOUND_MESSAGE,
  RowError,
  evaluateRows,
  multiplyDecimals,
  nameSimilarity,
} from './opening-stock-import.evaluator';

/** Canonical key → template column (for the error report). */
const COLUMN_OF: Record<string, string> = {
  store: 'Store Category',
  categoryCode: 'Category Code',
  partNumber: 'Part Number',
  partName: 'Part Name',
  partCode: 'Part Code',
  materialGrade: 'Material Grade',
  size: 'Size',
  uom: 'Inventory UOM',
  status: 'Status',
  locationCode: 'Location Code',
  binCode: 'Bin',
  vendorCode: 'Vendor Code',
  quantity: 'Qty',
  unitPrice: 'Unit Price',
  batchNo: 'Batch / Heat / Lot No.',
  serialNo: 'Serial No.',
  revision: 'Revision',
  remarks: 'Remarks',
  machineModel: 'Machine Model',
  machineNo: 'Machine No',
  category: 'Category',
};

type SimilarItem = { itemId: string; itemCode: string; name: string; score: number };

/** Similar-code / name lookup runs for at most this many rows per validation (cost grows with the item count). */
const SIMILAR_ROW_LIMIT = 1000;
/** A typed code this close to an existing part number is offered as "Did you mean ...?". */
const SIMILAR_CODE_MIN_SCORE = 0.75;

type StoredRow = Prisma.OpeningStockImportRowGetPayload<object>;

const notFound = () =>
  new BusinessException('Import not found', HttpStatus.NOT_FOUND, undefined, OPENING_IMPORT_ERROR_CODES.NOT_FOUND);

const locked = () =>
  new BusinessException(
    'This import is approved and can no longer be changed',
    HttpStatus.CONFLICT,
    undefined,
    OPENING_IMPORT_ERROR_CODES.LOCKED,
  );

const chunks = <T>(list: T[], size = OPENING_IMPORT_CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/**
 * Opening stock from Excel: upload → validate (Matched / Error) → approve (one posted Opening Stock).
 * Every Part Number must already exist in Item Master; the import never creates items.
 */
@Injectable()
export class OpeningStockImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly importSession: ImportSessionService,
    private readonly inventoryDocuments: InventoryDocumentsService,
    private readonly auditService: AuditService,
  ) {}

  private get db(): Prisma.TransactionClient {
    return this.prisma as unknown as Prisma.TransactionClient;
  }

  /** Data sheet (columns + one sample row) and an Instructions sheet describing every column. */
  async template() {
    const workbook = new ExcelJS.Workbook();
    const data = workbook.addWorksheet('Opening Stock');
    data.addRow([...OPENING_IMPORT_COLUMNS]);
    data.addRow(OPENING_IMPORT_SAMPLE_ROW);
    data.getRow(1).font = { bold: true };
    data.columns.forEach((column) => (column.width = 18));
    data.views = [{ state: 'frozen', ySplit: 1 }];

    const help = workbook.addWorksheet('Instructions');
    help.addRow(['Column', 'Required', 'What to enter']);
    help.getRow(1).font = { bold: true };
    for (const row of OPENING_IMPORT_INSTRUCTIONS) help.addRow(row);
    help.addRow([]);
    help.addRow(['Part Numbers', '', 'Every Part Number / Old Code must already exist in Item Master. Create new items in Item Master first. Ambiguous Old Code is an Error.']);
    help.addRow(['Location rule', '', 'Location Code = the Inventory Location (store) only. Bin = the bin inside that location. Do not write both in one cell.']);
    help.addRow(['Example — normal store', '', 'Category BRG | Part ANABRG00001 | Location BOS-001 | Bin (if used) | Qty 25 | Unit Price 180.50 | Vendor empty']);
    help.addRow(['Example — Sub Contractor', '', 'Category RM | Part ANARM00015 | Location SCS (Sub Contractor store code) | Bin empty | Vendor JW001 (job-work) | Qty 10 | Unit Price 0 (confirm zero valuation)']);
    help.addRow(['Nothing is posted on upload', '', 'Upload shows Matched and Error rows. Stock is posted only when you Approve.']);
    help.getColumn(1).width = 34;
    help.getColumn(2).width = 24;
    help.getColumn(3).width = 110;

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return { buffer, fileName: 'opening-stock-import-template.xlsx' };
  }

  /** Parse the file into a DRAFT batch, then validate + match every row. Nothing is posted. */
  async upload(companyId: string, actorId: string, file: Express.Multer.File, documentDate?: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const sheet = await this.importSession.parseFile(file);
    const { mapped, missing } = this.importSession.mapHeaders(sheet.headers, OPENING_IMPORT_ALIASES);
    const missingRequired = OPENING_IMPORT_REQUIRED_COLUMNS.filter((key) => missing.includes(key));
    if (missingRequired.length > 0) {
      const names = missingRequired.map((key) => COLUMN_OF[key]).join(', ');
      throw new BusinessException(
        `Missing columns: ${names}. Download the template for the expected columns.`,
        HttpStatus.BAD_REQUEST,
        missingRequired.map((key) => ({ field: key, message: `${COLUMN_OF[key]} column is required` })),
        OPENING_IMPORT_ERROR_CODES.MISSING_COLUMNS,
      );
    }

    const fileHash = createHash('sha256').update(file.buffer).digest('hex');
    const previous = await this.prisma.openingStockImportBatch.findFirst({
      where: { companyId: company, fileHash, status: OpeningStockImportStatus.APPROVED },
      select: { batchId: true },
      orderBy: { batchId: 'desc' },
    });

    const date = documentDate ?? new Date().toISOString().slice(0, 10);
    const batch = await this.prisma.openingStockImportBatch.create({
      data: {
        companyId: company,
        fileName: file.originalname.slice(0, 255),
        fileHash,
        documentDate: new Date(`${date}T00:00:00.000Z`),
        totalRows: sheet.rows.length,
        createdBy: BigInt(actorId),
      },
    });

    const rows = sheet.rows.map((raw, index) => {
      const data: ImportRowData = {};
      for (const [key, header] of Object.entries(mapped)) {
        const value = (raw[header] ?? '').trim();
        if (value) data[key as keyof ImportRowData] = value;
      }
      return { batchId: batch.batchId, companyId: company, rowNo: index + 2, rawData: data as Prisma.InputJsonValue };
    });
    for (const part of chunks(rows)) {
      await this.prisma.openingStockImportRow.createMany({ data: part });
    }

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'OpeningStockImport',
      entityId: batch.batchId.toString(),
      newValue: { fileName: batch.fileName, rows: rows.length, duplicateOfBatchId: previous?.batchId.toString() ?? null },
    });

    await this.validateBatch(companyId, batch.batchId.toString());
    return { ...(await this.summary(companyId, batch.batchId.toString())), duplicateOfBatchId: previous?.batchId.toString() ?? null };
  }

  async list(companyId: string, query: OpeningImportListQueryDto) {
    const company = parseBigIntId(companyId, 'companyId');
    const [items, total] = await Promise.all([
      this.prisma.openingStockImportBatch.findMany({
        where: { companyId: company },
        orderBy: { batchId: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: { document: { select: { documentNumber: true } } },
      }),
      this.prisma.openingStockImportBatch.count({ where: { companyId: company } }),
    ]);
    const rows = await this.auditService.withAuditList(
      items.map(({ document, ...b }) => serialize({ ...b, documentNumber: document?.documentNumber ?? null }) as Record<string, unknown>),
    );
    return toPaginatedResult(rows, total, query.page, query.limit);
  }

  /** Counts for the review header and the summary before approve (Matched and Error only). */
  async summary(companyId: string, batchId: string) {
    const batch = await this.findBatch(companyId, batchId);
    const [counts] = await this.prisma.$queryRaw<Array<{ excluded: number; stock_lines: number; zero_price: number }>>`
      SELECT
        COUNT(*) FILTER (WHERE excluded)::int AS excluded,
        COUNT(*) FILTER (WHERE match_status = 'MATCHED' AND NOT excluded)::int AS stock_lines,
        COUNT(*) FILTER (
          WHERE match_status = 'MATCHED' AND NOT excluded
            AND COALESCE(unit_price, 0) = 0
            AND NOT zero_price_confirmed
        )::int AS zero_price
      FROM opening_stock_import_rows
      WHERE batch_id = ${batch.batchId}`;
    const document = batch.documentId
      ? await this.prisma.inventoryDocument.findUnique({ where: { documentId: batch.documentId }, select: { documentNumber: true } })
      : null;
    const stockLines = counts?.stock_lines ?? 0;
    return serialize({
      batchId: batch.batchId,
      fileName: batch.fileName,
      status: batch.status,
      documentDate: batch.documentDate.toISOString().slice(0, 10),
      totalRows: batch.totalRows,
      matchedRows: batch.matchedRows,
      errorRows: batch.errorRows,
      excludedRows: counts?.excluded ?? 0,
      zeroPriceRows: counts?.zero_price ?? 0,
      stockLines,
      totalValue: batch.totalValue.toFixed(2),
      canApprove: batch.status !== OpeningStockImportStatus.APPROVED && stockLines > 0,
      documentId: batch.documentId,
      documentNumber: document?.documentNumber ?? null,
      errorMessage: batch.errorMessage,
      createdAt: batch.createdAt,
      approvedAt: batch.approvedAt,
    });
  }

  async listRows(companyId: string, batchId: string, query: OpeningImportRowsQueryDto) {
    const batch = await this.findBatch(companyId, batchId);
    const search = query.search?.trim();
    const where: Prisma.OpeningStockImportRowWhereInput = {
      batchId: batch.batchId,
      ...(query.excluded !== undefined ? { excluded: query.excluded } : {}),
      ...(query.matchStatus ? { matchStatus: query.matchStatus } : {}),
      ...(search
        ? {
            OR: [
              { partNumber: { contains: search, mode: 'insensitive' } },
              { partName: { contains: search, mode: 'insensitive' } },
              { partCode: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.openingStockImportRow.findMany({
        where,
        orderBy: { rowNo: 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.openingStockImportRow.count({ where }),
    ]);
    const views = await this.rowViews(batch.companyId, rows);
    return toPaginatedResult(views, total, query.page, query.limit);
  }

  /** Review-screen edit of one row's cells (e.g. correct the Part Number); the batch is re-validated. */
  async updateRow(companyId: string, batchId: string, rowId: string, dto: OpeningImportRowUpdateDto) {
    const batch = await this.findBatch(companyId, batchId);
    if (batch.status === OpeningStockImportStatus.APPROVED) throw locked();
    const row = await this.prisma.openingStockImportRow.findFirst({
      where: { rowId: parseBigIntId(rowId, 'rowId'), batchId: batch.batchId },
    });
    if (!row) {
      throw new BusinessException('Row not found', HttpStatus.NOT_FOUND, undefined, OPENING_IMPORT_ERROR_CODES.ROW_NOT_FOUND);
    }

    const data = { ...((row.rawData ?? {}) as Record<string, unknown>) };
    for (const [key, value] of Object.entries(dto.data ?? {})) {
      if (value === undefined) continue;
      const trimmed = String(value).trim();
      if (trimmed) data[key] = trimmed;
      else delete data[key];
    }

    await this.prisma.openingStockImportRow.update({
      where: { rowId: row.rowId },
      data: {
        rawData: data as Prisma.InputJsonValue,
        ...(dto.confirmZeroValuation !== undefined ? { zeroPriceConfirmed: dto.confirmZeroValuation } : {}),
        updatedAt: new Date(),
      },
    });
    await this.validateBatch(companyId, batchId);
    const fresh = await this.prisma.openingStockImportRow.findUniqueOrThrow({ where: { rowId: row.rowId } });
    const [view] = await this.rowViews(batch.companyId, [fresh]);
    return { row: view, summary: await this.summary(companyId, batchId) };
  }

  /** Leave rows out of (or back into) the approve. */
  async setExcluded(companyId: string, batchId: string, dto: OpeningImportExcludeDto) {
    const batch = await this.findBatch(companyId, batchId);
    if (batch.status === OpeningStockImportStatus.APPROVED) throw locked();
    const updated = await this.prisma.openingStockImportRow.updateMany({
      where: { batchId: batch.batchId, rowId: { in: dto.rowIds.map((id) => BigInt(id)) } },
      data: { excluded: dto.excluded, updatedAt: new Date() },
    });
    await this.validateBatch(companyId, batchId);
    return { updated: updated.count, summary: await this.summary(companyId, batchId) };
  }

  /** Re-resolve and re-match every row against current masters; writes results + counts. */
  async validateBatch(companyId: string, batchId: string) {
    const batch = await this.findBatch(companyId, batchId);
    if (batch.status === OpeningStockImportStatus.APPROVED) throw locked();
    const rows = await this.prisma.openingStockImportRow.findMany({
      where: { batchId: batch.batchId },
      orderBy: { rowNo: 'asc' },
    });
    const inputs: ImportRowInput[] = rows.map((r) => ({ rowNo: r.rowNo, data: (r.rawData ?? {}) as ImportRowData }));
    const ctx = await this.loadContext(batch.companyId, inputs);
    const results = evaluateRows(inputs, ctx);
    const similar = await this.similarItems(batch.companyId, inputs, results);

    const writes = rows.map((row, i) => ({
      row_id: row.rowId.toString(),
      ...this.rowWrite(inputs[i].data, results[i], similar.get(i) ?? null),
    }));
    for (const part of chunks(writes, OPENING_IMPORT_UPDATE_CHUNK)) {
      await this.writeRows(part);
    }

    let total = '0';
    let matched = 0;
    let errored = 0;
    results.forEach((r, i) => {
      if (r.matchStatus === 'ERROR') {
        errored++;
        return;
      }
      matched++;
      if (!rows[i].excluded) total = addDecimals(total, multiplyDecimals(r.quantity, r.unitPrice));
    });
    await this.prisma.openingStockImportBatch.update({
      where: { batchId: batch.batchId },
      data: {
        status: OpeningStockImportStatus.VALIDATED,
        totalRows: rows.length,
        matchedRows: matched,
        newRows: 0,
        errorRows: errored,
        totalValue: new Prisma.Decimal(total),
        errorMessage: null,
        updatedAt: new Date(),
      },
    });
    return this.summary(companyId, batchId);
  }

  /**
   * One transaction: re-check every Matched row's item, then post one Opening Stock document for the
   * Matched rows that still have a valid item. Rows whose item disappeared (or became unusable) in
   * the meantime are turned into Error rows and skipped. ERROR and excluded rows are never posted.
   * Nothing is ever created in Item Master. Any failure rolls everything back.
   */
  async approve(companyId: string, batchId: string, actorId: string, dto: Partial<OpeningImportApproveDto> = {}) {
    await this.validateBatch(companyId, batchId);
    const before = await this.summary(companyId, batchId);
    const batch = await this.findBatch(companyId, batchId);
    if (before.zeroPriceRows > 0 && !dto.confirmZeroPrice) {
      throw new BusinessException(
        `${before.zeroPriceRows} row(s) have unit price 0 without zero-valuation confirm. Confirm per row or set confirmZeroPrice on Approve.`,
        HttpStatus.BAD_REQUEST,
        [{ field: 'confirmZeroPrice', message: 'Zero-value rows need confirmation' }],
        OPENING_IMPORT_ERROR_CODES.ZERO_PRICE,
      );
    }
    if (dto.confirmZeroPrice) {
      await this.prisma.openingStockImportRow.updateMany({
        where: {
          batchId: batch.batchId,
          matchStatus: OpeningStockImportMatch.MATCHED,
          excluded: false,
          unitPrice: { equals: 0 },
        },
        data: { zeroPriceConfirmed: true, updatedAt: new Date() },
      });
    }
    if (before.stockLines === 0) {
      throw new BusinessException('There are no valid rows to post', HttpStatus.BAD_REQUEST, undefined, OPENING_IMPORT_ERROR_CODES.NOT_READY);
    }
    let result: { documentNumber: string; posted: number; rejected: number };
    try {
      result = await this.prisma.$transaction(
        async (client) => {
          const tx = client as unknown as Prisma.TransactionClient;
          await tx.$queryRaw`SELECT batch_id FROM opening_stock_import_batches WHERE batch_id = ${batch.batchId} FOR UPDATE`;
          const current = await tx.openingStockImportBatch.findUniqueOrThrow({ where: { batchId: batch.batchId } });
          if (current.status === OpeningStockImportStatus.APPROVED) throw locked();

          const candidates = await tx.openingStockImportRow.findMany({
            where: { batchId: batch.batchId, excluded: false, matchStatus: OpeningStockImportMatch.MATCHED },
            orderBy: { rowNo: 'asc' },
          });

          // Item may have been deleted / deactivated since the preview: reject that row, keep the rest.
          const itemIds = [...new Set(candidates.flatMap((r) => (r.matchedItemId ? [r.matchedItemId] : [])))];
          const live = await tx.item.findMany({
            where: { companyId: batch.companyId, itemId: { in: itemIds }, deletedAt: null, isActive: true, isInventoryItem: true, status: { not: 'inactive' } },
            select: { itemId: true },
          });
          const liveIds = new Set(live.map((i) => i.itemId.toString()));
          const rows = candidates.filter((r) => r.matchedItemId && liveIds.has(r.matchedItemId.toString()));
          const rejected = candidates.filter((r) => !rows.includes(r));
          if (rejected.length > 0) {
            await tx.openingStockImportRow.updateMany({
              where: { rowId: { in: rejected.map((r) => r.rowId) } },
              data: {
                matchStatus: OpeningStockImportMatch.ERROR,
                errorMessages: [{ field: 'partNumber', message: PART_NOT_FOUND_MESSAGE }] as unknown as Prisma.InputJsonValue,
                updatedAt: new Date(),
              },
            });
          }
          if (rows.length === 0) {
            throw new BusinessException(
              'None of the rows has a valid Part Number any more. Create the items in Item Master first.',
              HttpStatus.BAD_REQUEST,
              undefined,
              OPENING_IMPORT_ERROR_CODES.NOT_READY,
            );
          }

          const lines = rows.map((row) => ({
            itemId: row.matchedItemId!.toString(),
            // Sub Contractor rows: store + vendor; the vendor's location is found or created on posting.
            ...(row.subcontractStoreId && row.vendorId
              ? { storeCategoryId: row.subcontractStoreId.toString(), vendorId: row.vendorId.toString() }
              : { warehouseId: row.warehouseId!.toString() }),
            storageBinId: row.storageBinId?.toString() ?? null,
            quantity: row.quantity!.toString(),
            unitPrice: (row.unitPrice ?? new Prisma.Decimal(0)).toString(),
            zeroPriceConfirmed: dto.confirmZeroPrice === true,
            batchNo: row.batchNo ?? undefined,
            serialNo: row.serialNo ?? undefined,
            remarks: row.remarks ?? undefined,
          }));
          const refs = rows.map((row) => ({
            revision: row.revision,
            partCode: row.partCode,
            materialGrade: row.materialGrade,
            size: row.size,
          }));
          const document = await this.inventoryDocuments.createPostedOpeningStock(
            tx,
            companyId,
            { documentDate: current.documentDate.toISOString().slice(0, 10), remarks: `Opening stock import: ${current.fileName}`, lines },
            refs,
            actorId,
          );

          await tx.openingStockImportBatch.update({
            where: { batchId: batch.batchId },
            data: {
              status: OpeningStockImportStatus.APPROVED,
              documentId: document.documentId,
              approvedBy: BigInt(actorId),
              approvedAt: new Date(),
              matchedRows: rows.length,
              errorRows: { increment: rejected.length },
              errorMessage: null,
              updatedAt: new Date(),
            },
          });
          return { documentNumber: document.documentNumber, posted: rows.length, rejected: rejected.length };
        },
        { timeout: OPENING_IMPORT_APPROVE_TIMEOUT_MS, maxWait: 30_000 },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Approve failed';
      if (!(error instanceof BusinessException && (error.getResponse() as { code?: string }).code === OPENING_IMPORT_ERROR_CODES.LOCKED)) {
        await this.prisma.openingStockImportBatch.update({
          where: { batchId: batch.batchId },
          data: { status: OpeningStockImportStatus.FAILED, errorMessage: message.slice(0, 2000), updatedAt: new Date() },
        });
      }
      throw error;
    }

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'OpeningStockImport',
      entityId: batch.batchId.toString(),
      newValue: {
        action: 'approve',
        documentNumber: result.documentNumber,
        stockLines: result.posted,
        rejectedAtApprove: result.rejected,
        excludedRows: before.excludedRows,
        zeroPriceConfirmed: before.zeroPriceRows > 0 ? true : undefined,
      },
    });
    return serialize({ ...(await this.summary(companyId, batchId)), rejectedAtApprove: result.rejected });
  }

  /** Items created by imports approved before item creation was removed (history only). */
  async createdItems(companyId: string, batchId: string) {
    const batch = await this.findBatch(companyId, batchId);
    const ids = await this.prisma.openingStockImportRow.findMany({
      where: { batchId: batch.batchId, createdItemId: { not: null } },
      select: { createdItemId: true },
      distinct: ['createdItemId'],
    });
    const items = await this.prisma.item.findMany({
      where: { itemId: { in: ids.map((r) => r.createdItemId!) } },
      select: { itemId: true, itemCode: true, description: true, storeCategory: { select: { name: true } } },
      orderBy: { itemCode: 'asc' },
    });
    return serialize(items.map(({ storeCategory, ...i }) => ({ ...i, storeName: storeCategory?.name ?? null })));
  }

  /** One line per problem: Original Row No | Part Number | Column | Error Reason | Suggested Correction. */
  async errorReport(companyId: string, batchId: string) {
    const batch = await this.findBatch(companyId, batchId);
    const rows = await this.prisma.openingStockImportRow.findMany({
      where: { batchId: batch.batchId, excluded: false, matchStatus: OpeningStockImportMatch.ERROR },
      orderBy: { rowNo: 'asc' },
    });
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Errors');
    sheet.addRow(['Original Row No', 'Part Number', 'Column', 'Error Reason', 'Suggested Correction']);
    sheet.getRow(1).font = { bold: true };
    for (const row of rows) {
      const data = (row.rawData ?? {}) as Record<string, string>;
      const partNumber = data.partNumber ?? row.partNumber ?? '';
      for (const p of (row.errorMessages ?? []) as unknown as RowError[]) {
        sheet.addRow([row.rowNo, partNumber, COLUMN_OF[p.field] ?? p.field, p.message, p.suggestion ?? '']);
      }
    }
    sheet.columns.forEach((column, i) => (column.width = [16, 18, 22, 60, 60][i] ?? 18));
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return { buffer, fileName: `opening-stock-import-${batch.batchId}-errors.xlsx` };
  }

  private async findBatch(companyId: string, batchId: string) {
    const batch = await this.prisma.openingStockImportBatch.findFirst({
      where: { batchId: parseBigIntId(batchId, 'batchId'), companyId: parseBigIntId(companyId, 'companyId') },
    });
    if (!batch) throw notFound();
    return batch;
  }

  /** Column values for one row (snake_case, JSON-safe) for the bulk update below. */
  private rowWrite(data: ImportRowData, r: EvaluatedRow, similar: SimilarItem[] | null) {
    const t = (v: string | undefined, max: number) => (v ? v.trim().slice(0, max) : null);
    return {
      bin_text: t(data.binCode, 40),
      vendor_text: t(data.vendorCode, 40),
      vendor_id: r.vendorId,
      subcontract_store_id: r.subcontractStoreId,
      batch_no: t(data.batchNo, 60),
      serial_no: t(data.serialNo, 80),
      remarks: t(data.remarks, 255),
      similar_items: similar,
      store_text: t(data.store, 100),
      part_number: t(data.partNumber, 50)?.toUpperCase() ?? null,
      part_name: t(data.partName, 255),
      part_code: t(data.partCode, 80),
      material_grade: t(data.materialGrade, 80),
      size: t(data.size, 80),
      uom_text: t(data.uom, 40),
      status_text: t(data.status, 20),
      location_code: t(data.locationCode, 80),
      revision: t(data.revision, 40),
      machine_model: t(data.machineModel, 120),
      machine_no: t(data.machineNo, 120),
      category: t(data.category, 120),
      store_category_id: r.storeCategoryId,
      item_group_id: r.itemGroupId,
      uom_id: r.uomId,
      warehouse_id: r.warehouseId,
      storage_bin_id: r.storageBinId,
      quantity: r.quantity,
      unit_price: r.unitPrice,
      match_status: r.matchStatus,
      matched_item_id: r.matchedItemId,
      error_messages: r.errors,
    };
  }

  /** One UPDATE … FROM jsonb_to_recordset per chunk (5,000 rows → a handful of round trips). */
  private async writeRows(rows: Array<{ row_id: string } & ReturnType<OpeningStockImportService['rowWrite']>>) {
    const payload = JSON.stringify(rows);
    await this.prisma.$executeRaw`
      UPDATE opening_stock_import_rows AS r SET
        store_text = v.store_text, part_number = v.part_number, part_name = v.part_name,
        part_code = v.part_code, material_grade = v.material_grade, size = v.size,
        uom_text = v.uom_text, status_text = v.status_text, location_code = v.location_code,
        revision = v.revision, machine_model = v.machine_model, machine_no = v.machine_no,
        category = v.category, store_category_id = v.store_category_id, item_group_id = v.item_group_id, uom_id = v.uom_id,
        warehouse_id = v.warehouse_id, storage_bin_id = v.storage_bin_id,
        quantity = v.quantity, unit_price = v.unit_price,
        match_status = v.match_status::opening_stock_import_match,
        matched_item_id = v.matched_item_id, candidate_item_ids = NULL,
        error_messages = COALESCE(v.error_messages, '[]'::jsonb),
        bin_text = v.bin_text, batch_no = v.batch_no, serial_no = v.serial_no, remarks = v.remarks,
        similar_items = v.similar_items,
        vendor_text = v.vendor_text, vendor_id = v.vendor_id, subcontract_store_id = v.subcontract_store_id,
        new_item_confirmed = false,
        updated_at = NOW()
      FROM jsonb_to_recordset(${payload}::jsonb) AS v(
        row_id bigint, store_text text, part_number text, part_name text, part_code text,
        material_grade text, size text, uom_text text, status_text text, location_code text,
        revision text, machine_model text, machine_no text, category text,
        store_category_id bigint, item_group_id bigint, uom_id bigint, warehouse_id bigint, storage_bin_id bigint,
        quantity numeric, unit_price numeric, match_status text, matched_item_id bigint,
        error_messages jsonb,
        bin_text text, batch_no text, serial_no text, remarks text, similar_items jsonb,
        vendor_text text, vendor_id bigint, subcontract_store_id bigint
      )
      WHERE r.row_id = v.row_id`;
  }

  private async rowViews(companyId: bigint, rows: StoredRow[]) {
    const itemIds = new Set<bigint>();
    for (const r of rows) {
      if (r.matchedItemId) itemIds.add(r.matchedItemId);
      if (r.createdItemId) itemIds.add(r.createdItemId);
    }
    const items = await this.prisma.item.findMany({
      where: { companyId, itemId: { in: [...itemIds] } },
      select: {
        itemId: true,
        itemCode: true,
        description: true,
        inventoryUom: { select: { code: true } },
        itemGroupRef: { select: { categoryCode: true } },
      },
    });
    const itemById = new Map(
      items.map((i) => [
        i.itemId.toString(),
        { itemId: i.itemId, itemCode: i.itemCode, description: i.description, uom: i.inventoryUom?.code ?? null, itemType: i.itemGroupRef?.categoryCode ?? null },
      ]),
    );
    return rows.map((r) => {
      const quantity = r.quantity?.toString() ?? null;
      const unitPrice = r.unitPrice?.toString() ?? null;
      return serialize({
        rowId: r.rowId,
        rowNo: r.rowNo,
        data: (r.rawData ?? {}) as Record<string, string>,
        matchStatus: r.matchStatus,
        storeCategoryId: r.storeCategoryId,
        warehouseId: r.warehouseId,
        uomId: r.uomId,
        itemGroupId: r.itemGroupId,
        matchedItem: r.matchedItemId ? itemById.get(r.matchedItemId.toString()) ?? null : null,
        createdItem: r.createdItemId ? itemById.get(r.createdItemId.toString()) ?? null : null,
        quantity,
        unitPrice,
        totalPrice: multiplyDecimals(quantity, unitPrice ?? '0'),
        zeroPrice: r.matchStatus === OpeningStockImportMatch.MATCHED && Number(unitPrice ?? 0) === 0,
        zeroPriceConfirmed: Boolean(r.zeroPriceConfirmed),
        excluded: r.excluded,
        similarItems: r.similarItems ?? [],
        errors: r.errorMessages,
      });
    });
  }

  /** Every master the evaluator needs, loaded once per validation (5,000 rows → a few queries). */
  private async loadContext(companyId: bigint, inputs: ImportRowInput[]): Promise<EvaluationContext> {
    const db = this.db;
    const codes = [...new Set(inputs.map((i) => (i.data.partNumber ?? '').trim().toUpperCase()).filter(Boolean))];
    const vendorCodes = [...new Set(inputs.map((i) => (i.data.vendorCode ?? '').trim()).filter(Boolean))];

    const itemSelect = {
      itemId: true,
      itemCode: true,
      oldCode: true,
      isInventoryItem: true,
      isActive: true,
      status: true,
      manageBy: true,
      itemGroupRef: { select: { categoryCode: true } },
    } as const;

    const [stores, uoms, warehouses, bins, groups, itemsByCodeRows, itemsByOldRows, vendors] = await Promise.all([
      db.storeCategory.findMany({
        where: { companyId, deletedAt: null, isActive: true },
        select: { storeCategoryId: true, name: true, codePrefix: true, numberSeriesCode: true, storeType: true, isActive: true },
      }),
      db.uom.findMany({ where: { companyId, deletedAt: null, isActive: true }, select: { uomId: true, code: true, name: true } }),
      db.warehouse.findMany({
        where: { companyId, deletedAt: null },
        select: { warehouseId: true, warehouseCode: true, isActive: true, binManagement: true, storeCategoryId: true, vendorId: true },
      }),
      db.storageBin.findMany({
        where: { companyId, deletedAt: null },
        select: { storageBinId: true, warehouseId: true, binCode: true, isActive: true },
      }),
      db.itemGroup.findMany({
        where: { companyId, deletedAt: null, categoryCode: { not: null } },
        select: { itemGroupId: true, storeCategoryId: true, isActive: true, name: true, categoryCode: true },
      }),
      codes.length
        ? db.item.findMany({
            where: { companyId, deletedAt: null, itemCode: { in: codes, mode: 'insensitive' } },
            select: itemSelect,
          })
        : Promise.resolve([]),
      codes.length
        ? db.item.findMany({
            where: { companyId, deletedAt: null, oldCode: { in: codes, mode: 'insensitive' } },
            select: itemSelect,
          })
        : Promise.resolve([]),
      vendorCodes.length
        ? db.vendor.findMany({
            where: { companyId, deletedAt: null, vendorCode: { in: vendorCodes, mode: 'insensitive' } },
            select: { vendorId: true, vendorCode: true, name: true, isActive: true, isJobWorkVendor: true },
          })
        : Promise.resolve([]),
    ]);

    const info = (i: (typeof itemsByCodeRows)[number]): ItemInfo => ({
      itemId: i.itemId.toString(),
      itemCode: i.itemCode,
      categoryCode: i.itemGroupRef?.categoryCode ?? null,
      blockedReason: !i.isInventoryItem
        ? 'is not an inventory item'
        : !i.isActive || i.status === 'inactive'
          ? 'is inactive'
          : i.manageBy !== 'none'
            ? `is managed by ${i.manageBy} (not supported for opening stock yet)`
            : null,
    });

    const itemsByCode = new Map(itemsByCodeRows.map((i) => [i.itemCode.toUpperCase(), info(i)]));
    const itemsByOldCode = new Map<string, ItemInfo[]>();
    for (const i of itemsByOldRows) {
      const key = (i.oldCode ?? '').trim().toUpperCase();
      if (!key) continue;
      const list = itemsByOldCode.get(key) ?? [];
      list.push(info(i));
      itemsByOldCode.set(key, list);
    }

    const allMatchedIds = [
      ...new Set([
        ...itemsByCodeRows.map((i) => i.itemId),
        ...itemsByOldRows.map((i) => i.itemId),
      ]),
    ];
    const posted = allMatchedIds.length
      ? await db.stockLedgerEntry.findMany({
          where: { companyId, movementType: StockMovementType.OPENING_STOCK, itemId: { in: allMatchedIds } },
          select: { itemId: true, warehouseId: true, storageBinId: true },
          distinct: ['itemId', 'warehouseId', 'storageBinId'],
        })
      : [];

    return {
      stores: stores.map((s) => ({ id: s.storeCategoryId.toString(), name: s.name, codePrefix: s.codePrefix, numberSeriesCode: s.numberSeriesCode })),
      uoms: uoms.map((u) => ({ id: u.uomId.toString(), code: u.code, name: u.name })),
      warehouses: warehouses.map((w) => ({
        id: w.warehouseId.toString(),
        code: w.warehouseCode,
        isActive: w.isActive,
        binManagement: w.binManagement,
        vendorId: w.vendorId?.toString() ?? null,
      })),
      subcontractStores: stores
        .filter((s) => s.storeType === 'SUBCONTRACTOR')
        .map((s) => ({ id: s.storeCategoryId.toString(), code: s.codePrefix, name: s.name, isActive: s.isActive })),
      vendorsByCode: new Map(
        vendors.map((v) => [
          v.vendorCode.toUpperCase(),
          {
            id: v.vendorId.toString(),
            code: v.vendorCode,
            name: v.name,
            isActive: v.isActive,
            isJobWorkVendor: v.isJobWorkVendor,
          },
        ]),
      ),
      vendorLocations: new Map(
        warehouses.flatMap((w) => (w.vendorId && w.storeCategoryId ? [[`${w.storeCategoryId}|${w.vendorId}`, w.warehouseId.toString()] as [string, string]] : [])),
      ),
      bins: bins.map((b) => ({ id: b.storageBinId.toString(), warehouseId: b.warehouseId.toString(), code: b.binCode, isActive: b.isActive })),
      categories: groups.map((g) => ({
        id: g.itemGroupId.toString(),
        code: g.categoryCode!,
        name: g.name,
        storeId: g.storeCategoryId.toString(),
        isActive: g.isActive,
      })),
      itemsByCode,
      itemsByOldCode,
      openingPosted: new Set(posted.map((p) => `${p.itemId}|${p.warehouseId}|${p.storageBinId ?? ''}`)),
    };
  }

  /**
   * "Did you mean ...?" for Part Numbers that are not in Item Master: existing part numbers close to
   * the typed code, else items whose name is close to the row's Part Name. The best one becomes the
   * suggested correction; up to three are kept for the review screen.
   */
  private async similarItems(companyId: bigint, inputs: ImportRowInput[], results: EvaluatedRow[]) {
    const out = new Map<number, SimilarItem[]>();
    const targets = results
      .flatMap((r, i) => {
        const notFound = r.errors.find((e) => e.field === 'partNumber' && e.message === PART_NOT_FOUND_MESSAGE);
        return notFound ? [{ i, code: (inputs[i].data.partNumber ?? '').trim(), name: (inputs[i].data.partName ?? '').trim(), notFound }] : [];
      })
      .slice(0, SIMILAR_ROW_LIMIT);
    if (targets.length === 0) return out;
    const items = await this.prisma.item.findMany({
      where: { companyId, deletedAt: null },
      select: { itemId: true, itemCode: true, description: true },
    });
    const pick = (score: (item: (typeof items)[number]) => number, min: number) =>
      items
        .map((item) => ({ item, score: score(item) }))
        .filter((m) => m.score >= min)
        .sort((a, b) => b.score - a.score)
        .slice(0, OPENING_IMPORT_SIMILAR_MAX)
        .map((m) => ({ itemId: m.item.itemId.toString(), itemCode: m.item.itemCode, name: m.item.description, score: Math.round(m.score * 100) / 100 }));
    for (const t of targets) {
      let matches = t.code ? pick((item) => nameSimilarity(t.code, item.itemCode), SIMILAR_CODE_MIN_SCORE) : [];
      if (matches.length === 0 && t.name) matches = pick((item) => nameSimilarity(t.name, item.description), OPENING_IMPORT_SIMILAR_MIN_SCORE);
      if (matches.length === 0) continue;
      out.set(t.i, matches);
      if (!t.notFound.suggestion) t.notFound.suggestion = `Did you mean ${matches[0].itemCode} (${matches[0].name})?`;
    }
    return out;
  }
}

/** Sum of two non-negative decimal strings with 6 decimals. */
function addDecimals(a: string, b: string): string {
  const units = (v: string) => {
    const [int, frac = ''] = v.split('.');
    return BigInt(int) * 1_000_000n + BigInt((frac + '000000').slice(0, 6));
  };
  const sum = units(a) + units(b);
  return `${sum / 1_000_000n}.${(sum % 1_000_000n).toString().padStart(6, '0')}`;
}
