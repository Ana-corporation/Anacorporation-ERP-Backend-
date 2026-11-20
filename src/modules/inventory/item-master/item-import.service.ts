import { HttpStatus, Injectable } from '@nestjs/common';
import { ImportType, UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { BusinessException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import {
  IMPORT_CONFIRM_CHUNK_SIZE,
  IMPORT_ERROR_CODES,
  ImportSummary,
  ImportValidatedRow,
} from '@/modules/imports/import.constants';
import { ImportSessionService } from '@/modules/imports/import-session.service';
import { ExcelParserService } from '@/modules/imports/parsers/excel-parser.service';
import { CreateItemDto } from './dto/item.dto';
import { ItemsService } from './items.service';

/** Material Type labels → store numberSeriesCode (Store is derived, never imported). */
const MATERIAL_TYPE_ALIASES: Record<string, string> = {
  mechanical: 'RM',
  'mechanical (rm)': 'RM',
  rm: 'RM',
  'bought-out': 'BO',
  'bought-out (bo)': 'BO',
  'bought out': 'BO',
  bo: 'BO',
  electrical: 'ES',
  'electrical (es)': 'ES',
  es: 'ES',
  general: 'GS',
  'general (gs)': 'GS',
  gs: 'GS',
  oil: 'OS',
  'oil (os)': 'OS',
  os: 'OS',
  finished: 'FF',
  'finished (ff)': 'FF',
  ff: 'FF',
};

const PROCESS_STAGE = 'SF';

const ITEM_HEADER_ALIASES: Record<string, string[]> = {
  description: ['Description', 'Part Name', 'Item Name', 'Name', 'description'],
  materialType: ['Material Type', 'Type', 'materialType', 'material_type'],
  segmentCategory: ['Segment Category', 'Category', 'Category Code', 'segmentCategory', 'categoryCode'],
  process: ['Process', 'Process Category', 'process', 'processCategoryCode'],
  oldCode: ['Old Code', 'Old / Drawing', 'Drawing Number', 'oldCode', 'old_code'],
  uom: ['UoM', 'UOM', 'Inventory UOM', 'Unit', 'uom'],
  itemCode: ['Item Code', 'Part Number', 'itemCode', 'item_code'],
  isInventoryItem: ['Is Inventory Item', 'Inventory Item', 'isInventoryItem'],
  isActive: ['Is Active', 'Active', 'isActive'],
  barcode: ['Bar Code', 'Barcode', 'barcode'],
  manufacturer: ['Manufacturer', 'manufacturer'],
  brandName: ['Brand', 'Brand Name', 'brandName'],
};

const REQUIRED_FIELDS = ['description', 'materialType', 'segmentCategory'] as const;

type MasterMaps = {
  storesBySeries: Map<string, { id: string; code: string }>;
  groupsByCode: Map<
    string,
    { id: string; code: string; storeId: string; seriesCode: string | null; materialStage: string | null; isActive: boolean }
  >;
  uomsByCode: Map<string, string>;
  existingItemCodes: Set<string>;
  existingOldCodes: Map<string, string>;
};

@Injectable()
export class ItemImportService {
  constructor(
    private readonly importSessions: ImportSessionService,
    private readonly excelParser: ExcelParserService,
    private readonly itemsService: ItemsService,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async downloadTemplate(): Promise<{ buffer: Buffer; fileName: string }> {
    const headers = [
      'Description',
      'Material Type',
      'Segment Category',
      'Process',
      'Old Code',
      'UoM',
      'Item Code',
      'Is Inventory Item',
      'Is Active',
    ];
    const sample = [
      'MAIN SIDE PLATE RH',
      'Mechanical (RM)',
      'RM',
      'PLT',
      'BS5018030010',
      'NOS',
      '',
      'TRUE',
      'TRUE',
    ];
    const buffer = await this.excelParser.buildTemplate(headers, sample);
    return { buffer, fileName: 'item-import-template.xlsx' };
  }

  async validate(companyId: string, actorId: string, file: Express.Multer.File) {
    const sheet = await this.importSessions.parseFile(file);
    const { mapped, missing } = this.importSessions.mapHeaders(
      sheet.headers,
      Object.fromEntries(REQUIRED_FIELDS.map((f) => [f, ITEM_HEADER_ALIASES[f]])),
    );
    if (missing.length) {
      throw new BusinessException(
        `Missing required column(s): ${missing.join(', ')}`,
        HttpStatus.BAD_REQUEST,
        undefined,
        IMPORT_ERROR_CODES.MISSING_REQUIRED_COLUMN,
      );
    }
    const allMapped = this.importSessions.mapHeaders(sheet.headers, ITEM_HEADER_ALIASES).mapped;
    Object.assign(mapped, allMapped);

    const masters = await this.loadMasters(companyId);
    const seenOld = new Set<string>();
    const seenCodes = new Set<string>();
    const rows: ImportValidatedRow[] = sheet.rows.map((raw, idx) => {
      const rowNumber = idx + 2;
      const data = this.extractRow(raw, mapped);
      const errors = this.validateRow(data, masters, seenOld, seenCodes);
      return { rowNumber, status: errors.length ? 'INVALID' : 'VALID', data, errors };
    });

    const summary: ImportSummary = {
      totalRows: rows.length,
      validRows: rows.filter((r) => r.status === 'VALID').length,
      invalidRows: rows.filter((r) => r.status === 'INVALID').length,
    };

    const session = await this.importSessions.createValidatedSession({
      companyId,
      actorId,
      importType: ImportType.ITEM,
      file,
      rows,
      summary,
    });

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'ImportSession',
      entityId: session.importSessionId.toString(),
      newValue: { type: 'ITEM', status: 'VALIDATED', ...summary },
    });

    return serialize({
      importId: session.importSessionId.toString(),
      type: 'ITEM',
      fileName: session.fileName,
      status: session.status,
      summary,
      rows,
      expiresAt: session.expiresAt.toISOString(),
    });
  }

  async getImport(companyId: string, importId: string) {
    const session = await this.importSessions.getSession(companyId, importId, ImportType.ITEM);
    const rows = this.importSessions.getValidatedRows(session);
    return serialize({
      importId: session.importSessionId.toString(),
      type: session.importType,
      fileName: session.fileName,
      status: session.status,
      summary: session.summaryJson,
      rows,
      errorMessage: session.errorMessage,
      expiresAt: session.expiresAt.toISOString(),
      completedAt: session.completedAt?.toISOString() ?? null,
    });
  }

  async confirm(companyId: string, actorId: string, importId: string) {
    const session = await this.importSessions.getSession(companyId, importId, ImportType.ITEM);
    this.importSessions.assertConfirmable(session);
    const rows = this.importSessions.getValidatedRows(session);
    await this.importSessions.markImporting(importId);

    let importedRows = 0;
    let skippedRows = 0;
    let failedRows = 0;
    const failDetails: Array<{ rowNumber: number; message: string }> = [];
    const masters = await this.loadMasters(companyId);

    try {
      const validRows = rows.filter((r) => r.status === 'VALID');
      for (let i = 0; i < validRows.length; i += IMPORT_CONFIRM_CHUNK_SIZE) {
        const chunk = validRows.slice(i, i + IMPORT_CONFIRM_CHUNK_SIZE);
        for (const row of chunk) {
          const recheck = this.validateRow(row.data as Record<string, unknown>, masters, new Set(), new Set());
          if (recheck.length) {
            skippedRows += 1;
            continue;
          }
          try {
            const dto = this.toCreateDto(row.data as Record<string, unknown>, masters);
            await this.itemsService.create(companyId, dto, actorId);
            importedRows += 1;
            const old = String((row.data as Record<string, unknown>).oldCode ?? '')
              .trim()
              .toUpperCase();
            if (old) masters.existingOldCodes.set(old, '(imported)');
          } catch (err) {
            failedRows += 1;
            failDetails.push({
              rowNumber: row.rowNumber,
              message: err instanceof Error ? err.message : 'Import failed',
            });
          }
        }
      }

      const summary: ImportSummary = {
        totalRows: rows.length,
        validRows: rows.filter((r) => r.status === 'VALID').length,
        invalidRows: rows.filter((r) => r.status === 'INVALID').length,
        importedRows,
        skippedRows,
        failedRows,
      };
      await this.importSessions.markCompleted(importId, summary);
      await this.auditService.log({
        companyId,
        performedBy: actorId,
        action: UserAuditAction.create,
        entityName: 'ItemImport',
        entityId: importId,
        newValue: summary as unknown as Record<string, unknown>,
      });
      return serialize({ importId, status: 'COMPLETED', summary, failures: failDetails.slice(0, 50) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      await this.importSessions.markFailed(importId, message);
      throw err;
    }
  }

  private async loadMasters(companyId: string): Promise<MasterMaps> {
    const company = BigInt(companyId);
    const [stores, groups, uoms, items] = await Promise.all([
      this.prisma.storeCategory.findMany({
        where: { companyId: company, deletedAt: null, isActive: true },
        select: { storeCategoryId: true, numberSeriesCode: true, codePrefix: true },
      }),
      this.prisma.itemGroup.findMany({
        where: { companyId: company, deletedAt: null, categoryCode: { not: null } },
        select: {
          itemGroupId: true,
          categoryCode: true,
          storeCategoryId: true,
          materialStage: true,
          isActive: true,
          storeCategory: { select: { numberSeriesCode: true } },
        },
      }),
      this.prisma.uom.findMany({
        where: { companyId: company, deletedAt: null, isActive: true },
        select: { uomId: true, code: true },
      }),
      this.prisma.item.findMany({
        where: { companyId: company, deletedAt: null },
        select: { itemCode: true, oldCode: true },
      }),
    ]);

    const storesBySeries = new Map<string, { id: string; code: string }>();
    for (const s of stores) {
      if (s.numberSeriesCode) {
        storesBySeries.set(s.numberSeriesCode.toUpperCase(), {
          id: s.storeCategoryId.toString(),
          code: s.numberSeriesCode.toUpperCase(),
        });
      }
    }

    const groupsByCode = new Map<
      string,
      { id: string; code: string; storeId: string; seriesCode: string | null; materialStage: string | null; isActive: boolean }
    >();
    for (const g of groups) {
      const code = (g.categoryCode ?? '').toUpperCase();
      if (!code) continue;
      groupsByCode.set(code, {
        id: g.itemGroupId.toString(),
        code,
        storeId: g.storeCategoryId.toString(),
        seriesCode: g.storeCategory.numberSeriesCode?.toUpperCase() ?? null,
        materialStage: g.materialStage?.toUpperCase() ?? null,
        isActive: g.isActive,
      });
    }

    const existingOldCodes = new Map<string, string>();
    for (const i of items) {
      const old = (i.oldCode ?? '').trim().toUpperCase();
      if (old) existingOldCodes.set(old, i.itemCode);
    }

    return {
      storesBySeries,
      groupsByCode,
      uomsByCode: new Map(uoms.map((u) => [u.code.toUpperCase(), u.uomId.toString()])),
      existingItemCodes: new Set(items.map((i) => i.itemCode.toUpperCase())),
      existingOldCodes,
    };
  }

  private extractRow(raw: Record<string, string>, mapped: Record<string, string>): Record<string, unknown> {
    const get = (field: string) => {
      const header = mapped[field];
      return header ? (raw[header] ?? '').trim() : '';
    };
    const parseBool = (rawVal: string): boolean | undefined => {
      const v = rawVal.toLowerCase();
      if (v === 'true' || v === '1' || v === 'yes' || v === 'y') return true;
      if (v === 'false' || v === '0' || v === 'no' || v === 'n') return false;
      return undefined;
    };
    return {
      description: get('description'),
      materialType: get('materialType'),
      segmentCategory: get('segmentCategory').toUpperCase(),
      process: get('process').toUpperCase(),
      oldCode: get('oldCode') || undefined,
      uom: get('uom').toUpperCase() || undefined,
      itemCode: get('itemCode').toUpperCase() || undefined,
      isInventoryItem: parseBool(get('isInventoryItem')),
      isActive: parseBool(get('isActive')),
      barcode: get('barcode') || undefined,
      manufacturer: get('manufacturer') || undefined,
      brandName: get('brandName') || undefined,
    };
  }

  private validateRow(
    data: Record<string, unknown>,
    masters: MasterMaps,
    seenOld: Set<string>,
    seenCodes: Set<string>,
  ): ImportValidatedRow['errors'] {
    const errors: ImportValidatedRow['errors'] = [];
    const description = String(data.description ?? '').trim();
    const materialRaw = String(data.materialType ?? '').trim().toLowerCase();
    const seriesCode = MATERIAL_TYPE_ALIASES[materialRaw];
    const segment = String(data.segmentCategory ?? '').trim().toUpperCase();
    const process = String(data.process ?? '').trim().toUpperCase();

    if (!description) {
      errors.push({ field: 'description', code: IMPORT_ERROR_CODES.MISSING_REQUIRED_FIELD, message: 'Description is required' });
    }
    if (!seriesCode) {
      errors.push({
        field: 'materialType',
        code: IMPORT_ERROR_CODES.INVALID_CATEGORY,
        message: 'Material Type must be Mechanical (RM), Bought-out (BO), Electrical (ES), General (GS), Oil (OS) or Finished (FF)',
      });
    }
    if (!segment) {
      errors.push({
        field: 'segmentCategory',
        code: IMPORT_ERROR_CODES.MISSING_REQUIRED_FIELD,
        message: 'Segment Category is required',
      });
    } else {
      const group = masters.groupsByCode.get(segment);
      if (!group) {
        errors.push({
          field: 'segmentCategory',
          code: IMPORT_ERROR_CODES.INVALID_CATEGORY,
          message: `Unknown Segment Category "${segment}"`,
        });
      } else if (!group.isActive) {
        errors.push({
          field: 'segmentCategory',
          code: IMPORT_ERROR_CODES.INVALID_CATEGORY,
          message: `Segment Category ${segment} is inactive`,
        });
      } else if (group.materialStage === PROCESS_STAGE) {
        errors.push({
          field: 'segmentCategory',
          code: IMPORT_ERROR_CODES.INVALID_CATEGORY,
          message: `${segment} is a Process code — put it in the Process column, not Segment Category`,
        });
      } else if (seriesCode && group.seriesCode && group.seriesCode !== seriesCode) {
        errors.push({
          field: 'segmentCategory',
          code: IMPORT_ERROR_CODES.INVALID_CATEGORY,
          message: `Segment ${segment} belongs to Material Type ${group.seriesCode}, not ${seriesCode}`,
        });
      } else if (seriesCode && !masters.storesBySeries.has(seriesCode) && !group.storeId) {
        errors.push({
          field: 'materialType',
          code: IMPORT_ERROR_CODES.INVALID_CATEGORY,
          message: `No Store found for Material Type ${seriesCode}`,
        });
      }

      if (seriesCode === 'RM') {
        if (!process) {
          errors.push({
            field: 'process',
            code: IMPORT_ERROR_CODES.MISSING_REQUIRED_FIELD,
            message: 'Process is required for Mechanical (RM)',
          });
        } else {
          const processGroup = masters.groupsByCode.get(process);
          if (!processGroup || processGroup.materialStage !== PROCESS_STAGE) {
            errors.push({
              field: 'process',
              code: IMPORT_ERROR_CODES.INVALID_CATEGORY,
              message: `Process must be an SF-stage category (PLT, MCN, FAB, SHM, SPR, …)`,
            });
          }
        }
      } else if (process) {
        errors.push({
          field: 'process',
          code: IMPORT_ERROR_CODES.INVALID_TEMPLATE,
          message: 'Process is only for Mechanical (RM) rows',
        });
      }
    }

    const uom = String(data.uom ?? '').trim().toUpperCase();
    if (uom && !masters.uomsByCode.has(uom)) {
      errors.push({ field: 'uom', code: IMPORT_ERROR_CODES.INVALID_UNIT, message: `Unknown UoM "${uom}"` });
    }

    const itemCode = String(data.itemCode ?? '').trim().toUpperCase();
    if (itemCode) {
      if (masters.existingItemCodes.has(itemCode) || seenCodes.has(itemCode)) {
        errors.push({
          field: 'itemCode',
          code: IMPORT_ERROR_CODES.DUPLICATE_ITEM_CODE,
          message: `Item Code ${itemCode} already exists`,
        });
      } else seenCodes.add(itemCode);
    }

    const oldCode = String(data.oldCode ?? '').trim().toUpperCase();
    if (oldCode) {
      const existing = masters.existingOldCodes.get(oldCode);
      if (existing || seenOld.has(oldCode)) {
        errors.push({
          field: 'oldCode',
          code: IMPORT_ERROR_CODES.DUPLICATE_ITEM_CODE,
          message: existing
            ? `Old Code "${oldCode}" already used by ${existing}`
            : `Duplicate Old Code "${oldCode}" in file`,
        });
      } else seenOld.add(oldCode);
    }

    // Resolved ids for confirm (kept on the row data)
    if (errors.length === 0 && seriesCode && segment) {
      const group = masters.groupsByCode.get(segment)!;
      data.storeCategoryId = group.storeId;
      data.itemGroupId = group.id;
      data.seriesCode = seriesCode;
      if (uom) data.inventoryUomId = masters.uomsByCode.get(uom);
      if (seriesCode === 'RM' && process) {
        data.stagePlan = 'RM_PROCESS';
        data.processCategoryCode = process;
      }
    }

    return errors;
  }

  private toCreateDto(data: Record<string, unknown>, _masters: MasterMaps): CreateItemDto {
    return {
      description: String(data.description),
      storeCategoryId: String(data.storeCategoryId),
      itemGroupId: String(data.itemGroupId),
      inventoryUomId: data.inventoryUomId ? String(data.inventoryUomId) : undefined,
      oldCode: data.oldCode ? String(data.oldCode) : undefined,
      itemCode: data.itemCode ? String(data.itemCode) : undefined,
      barcode: data.barcode ? String(data.barcode) : undefined,
      manufacturer: data.manufacturer ? String(data.manufacturer) : undefined,
      brandName: data.brandName ? String(data.brandName) : undefined,
      isInventoryItem: typeof data.isInventoryItem === 'boolean' ? data.isInventoryItem : true,
      isActive: typeof data.isActive === 'boolean' ? data.isActive : true,
      stagePlan: data.stagePlan === 'RM_PROCESS' ? 'RM_PROCESS' : undefined,
      processCategoryCode: data.processCategoryCode ? String(data.processCategoryCode) : undefined,
      confirmDuplicateName: true,
    } as CreateItemDto;
  }
}
