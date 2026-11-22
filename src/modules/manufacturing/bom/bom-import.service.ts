import { HttpStatus, Injectable } from '@nestjs/common';
import { BomStatus, ImportType, Prisma, UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { BusinessException } from '@/common/exceptions/business.exception';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { serialize } from '@/common/utils/bigint.util';
import {
  IMPORT_ERROR_CODES,
  ImportSummary,
  ImportValidatedRow,
} from '@/modules/imports/import.constants';
import { ImportSessionService } from '@/modules/imports/import-session.service';
import { ExcelParserService } from '@/modules/imports/parsers/excel-parser.service';
import { DocumentNumberService } from '@/modules/shared/number-series/document-number.service';
import { BOM_ERROR_CODES, bomError } from './bom.constants';
import { BomLinesService, actorOf } from './bom-lines.service';
import { loadProcurementTypes } from '@/modules/inventory/item-master/item-procurement.util';
import { checkParent, toDecimal } from './bom-validation';
import { BomViewService } from './bom-view.service';
import { BomsRepository } from './boms.repository';

const BOM_HEADER_ALIASES: Record<string, string[]> = {
  findNumber: ['Find Number', 'Find No', 'Item No', 'findNumber', 'find_number'],
  partNumber: ['Part Number', 'Item Code', 'Part No', 'partNumber', 'itemCode'],
  oldCode: ['Old Code', 'Old / Drawing', 'Drawing Number', 'oldCode'],
  quantity: ['Quantity', 'Qty', 'quantity'],
  scrapPercentage: ['Scrap %', 'Scrap', 'scrapPercentage', 'scrap'],
  remarks: ['Remarks', 'remarks'],
};

const REQUIRED = ['findNumber', 'quantity'] as const;

export type BomImportConfirmInput = {
  importId: string;
  parentItemId?: string;
  machineId?: string;
  bomType?: 'ENGINEERING' | 'MANUFACTURING';
  baseQuantity?: string;
  revisionLabel?: string;
  remarks?: string;
};

type MatchedLine = {
  rowNumber: number;
  findNumber: string;
  lineType: 'MAIN' | 'SUB';
  commonKey: string;
  componentItemId: string;
  itemCode: string;
  oldCode: string | null;
  quantity: string;
  scrapPercentage: string;
  remarks: string | null;
};

@Injectable()
export class BomImportService {
  constructor(
    private readonly importSessions: ImportSessionService,
    private readonly excelParser: ExcelParserService,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly repository: BomsRepository,
    private readonly lines: BomLinesService,
    private readonly view: BomViewService,
    private readonly documentNumbers: DocumentNumberService,
  ) {}

  async downloadTemplate(): Promise<{ buffer: Buffer; fileName: string }> {
    const headers = ['Find Number', 'Part Number', 'Old Code', 'Quantity', 'Scrap %', 'Remarks'];
    const sample = ['16', 'ANARM00015', 'BS5018050010', '1', '0', 'MAIN assembly'];
    const buffer = await this.excelParser.buildTemplate(headers, sample);
    return { buffer, fileName: 'bom-import-template.xlsx' };
  }

  async validate(companyId: string, actorId: string, file: Express.Multer.File) {
    const sheet = await this.importSessions.parseFile(file);
    const { mapped, missing } = this.importSessions.mapHeaders(
      sheet.headers,
      Object.fromEntries(REQUIRED.map((f) => [f, BOM_HEADER_ALIASES[f]])),
    );
    if (missing.length) {
      throw new BusinessException(
        `Missing required column(s): ${missing.join(', ')}`,
        HttpStatus.BAD_REQUEST,
        undefined,
        IMPORT_ERROR_CODES.MISSING_REQUIRED_COLUMN,
      );
    }
    Object.assign(mapped, this.importSessions.mapHeaders(sheet.headers, BOM_HEADER_ALIASES).mapped);

    const extracted = sheet.rows.map((raw, idx) => ({
      rowNumber: idx + 2,
      ...this.extractRow(raw, mapped),
    }));

    const codes = [
      ...new Set(
        extracted.flatMap((r) =>
          [r.partNumber, r.oldCode].map((v) => (v ?? '').trim().toUpperCase()).filter(Boolean),
        ),
      ),
    ];
    const items = codes.length
      ? await this.prisma.item.findMany({
          where: {
            companyId: BigInt(companyId),
            deletedAt: null,
            OR: [
              { itemCode: { in: codes, mode: 'insensitive' } },
              { oldCode: { in: codes, mode: 'insensitive' } },
            ],
          },
          select: { itemId: true, itemCode: true, oldCode: true, isActive: true, status: true },
        })
      : [];

    const byCode = new Map(items.map((i) => [i.itemCode.toUpperCase(), i]));
    const byOld = new Map<string, typeof items>();
    for (const i of items) {
      const key = (i.oldCode ?? '').trim().toUpperCase();
      if (!key) continue;
      const list = byOld.get(key) ?? [];
      list.push(i);
      byOld.set(key, list);
    }

    const findKeys = new Map<string, number>(); // MAIN find integer → first row
    const rows: ImportValidatedRow[] = [];
    const matched: MatchedLine[] = [];

    for (const row of extracted) {
      const errors: ImportValidatedRow['errors'] = [];
      const findNumber = row.findNumber;
      const parsed = parseFind(findNumber);
      if (!parsed) {
        errors.push({
          field: 'findNumber',
          code: 'MAIN_WITHOUT_FIND',
          message: 'Find Number is required (e.g. 16 or 16.1)',
        });
      } else if (parsed.kind === 'SUB' && !findKeys.has(parsed.commonKey)) {
        errors.push({
          field: 'findNumber',
          code: 'SUB_WITHOUT_MAIN',
          message: `SUB find ${findNumber} has no MAIN ${parsed.commonKey} in the file`,
        });
      } else if (parsed.kind === 'MAIN') {
        if (findKeys.has(parsed.commonKey)) {
          errors.push({
            field: 'findNumber',
            code: IMPORT_ERROR_CODES.INVALID_TEMPLATE,
            message: `Duplicate MAIN find ${parsed.commonKey}`,
          });
        } else findKeys.set(parsed.commonKey, row.rowNumber);
      }

      const qty = toDecimal(row.quantity);
      if (!qty || qty.lte(0)) {
        errors.push({
          field: 'quantity',
          code: BOM_ERROR_CODES.QTY_MUST_BE_POSITIVE,
          message: 'Quantity must be positive',
        });
      }

      let matchedItem: (typeof items)[number] | null = null;
      const part = (row.partNumber ?? '').trim().toUpperCase();
      const old = (row.oldCode ?? '').trim().toUpperCase();
      if (part) matchedItem = byCode.get(part) ?? null;
      if (!matchedItem && old) {
        const list = byOld.get(old) ?? [];
        if (list.length > 1) {
          errors.push({
            field: 'oldCode',
            code: 'AMBIGUOUS_OLD_CODE',
            message: `Old Code "${old}" matches more than one item`,
          });
        } else if (list.length === 1) matchedItem = list[0];
      }
      if (!matchedItem && !errors.some((e) => e.field === 'oldCode')) {
        errors.push({
          field: part ? 'partNumber' : 'oldCode',
          code: 'UNMATCHED_ITEM',
          message: 'Part not found in Item Master. Create the item first.',
        });
      } else if (matchedItem && (!matchedItem.isActive || matchedItem.status === 'inactive')) {
        errors.push({
          field: 'partNumber',
          code: BOM_ERROR_CODES.COMPONENT_INACTIVE,
          message: `${matchedItem.itemCode} is inactive`,
        });
      }

      const scrapRaw = (row.scrapPercentage ?? '').trim();
      let scrap = '0';
      if (scrapRaw) {
        const s = toDecimal(scrapRaw);
        if (!s || s.lt(0) || s.gt(100)) {
          errors.push({
            field: 'scrapPercentage',
            code: BOM_ERROR_CODES.SCRAP_OUT_OF_RANGE,
            message: 'Scrap % must be 0–100',
          });
        } else scrap = s.toString();
      }

      const data: Record<string, unknown> = {
        findNumber,
        partNumber: row.partNumber || undefined,
        oldCode: row.oldCode || undefined,
        quantity: row.quantity,
        scrapPercentage: scrap,
        remarks: row.remarks || undefined,
        lineType: parsed?.kind ?? null,
        commonKey: parsed?.commonKey ?? null,
        componentItemId: matchedItem?.itemId.toString() ?? null,
        itemCode: matchedItem?.itemCode ?? null,
      };

      if (errors.length === 0 && parsed && matchedItem && qty) {
        matched.push({
          rowNumber: row.rowNumber,
          findNumber,
          lineType: parsed.kind,
          commonKey: parsed.commonKey,
          componentItemId: matchedItem.itemId.toString(),
          itemCode: matchedItem.itemCode,
          oldCode: matchedItem.oldCode,
          quantity: qty.toString(),
          scrapPercentage: scrap,
          remarks: row.remarks || null,
        });
      }

      rows.push({
        rowNumber: row.rowNumber,
        status: errors.length ? 'INVALID' : 'VALID',
        data,
        errors,
      });
    }

    // Duplicate component within the same MAIN group
    const byGroup = new Map<string, MatchedLine[]>();
    for (const m of matched) {
      const list = byGroup.get(m.commonKey) ?? [];
      list.push(m);
      byGroup.set(m.commonKey, list);
    }
    for (const [, groupLines] of byGroup) {
      const seen = new Map<string, number>();
      for (const line of groupLines) {
        const prev = seen.get(line.componentItemId);
        if (prev !== undefined) {
          const row = rows.find((r) => r.rowNumber === line.rowNumber);
          row?.errors.push({
            field: 'partNumber',
            code: BOM_ERROR_CODES.DUPLICATE_COMPONENT,
            message: `Same item twice under Key ${line.commonKey} (also row ${prev})`,
          });
          if (row) row.status = 'INVALID';
        } else seen.set(line.componentItemId, line.rowNumber);
      }
    }

    // Attach structured groups preview on valid-only summary payload via rows data
    const summary: ImportSummary & { matchedGroups?: number } = {
      totalRows: rows.length,
      validRows: rows.filter((r) => r.status === 'VALID').length,
      invalidRows: rows.filter((r) => r.status === 'INVALID').length,
      matchedGroups: [...byGroup.keys()].length,
    };

    // Persist matched lines inside row data for confirm (only VALID rows)
    const session = await this.importSessions.createValidatedSession({
      companyId,
      actorId,
      importType: ImportType.BOM,
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
      newValue: { type: 'BOM', status: 'VALIDATED', ...summary },
    });

    return serialize({
      importId: session.importSessionId.toString(),
      type: 'BOM',
      fileName: session.fileName,
      status: session.status,
      summary,
      rows,
      expiresAt: session.expiresAt.toISOString(),
    });
  }

  async getImport(companyId: string, importId: string) {
    const session = await this.importSessions.getSession(companyId, importId, ImportType.BOM);
    return serialize({
      importId: session.importSessionId.toString(),
      type: session.importType,
      fileName: session.fileName,
      status: session.status,
      summary: session.summaryJson,
      rows: this.importSessions.getValidatedRows(session),
      errorMessage: session.errorMessage,
      expiresAt: session.expiresAt.toISOString(),
      completedAt: session.completedAt?.toISOString() ?? null,
    });
  }

  async confirm(companyId: string, user: AuthenticatedUser, input: BomImportConfirmInput) {
    const session = await this.importSessions.getSession(companyId, input.importId, ImportType.BOM);
    this.importSessions.assertConfirmable(session);

    const rows = this.importSessions.getValidatedRows(session);
    if (rows.some((r) => r.status === 'INVALID')) {
      throw new BusinessException(
        'Fix all row errors before confirming. A half BOM is never created.',
        HttpStatus.BAD_REQUEST,
        undefined,
        IMPORT_ERROR_CODES.INVALID_TEMPLATE,
      );
    }
    if (!rows.length) {
      throw new BusinessException('Import has no rows', HttpStatus.BAD_REQUEST, undefined, IMPORT_ERROR_CODES.EMPTY_FILE);
    }

    await this.importSessions.markImporting(input.importId);
    const actorId = actorOf(user);
    const company = BigInt(companyId);

    try {
      const bomId = await this.repository.transaction(async (tx) => {
        let parentId = input.parentItemId ? BigInt(input.parentItemId) : null;
        if (input.machineId) {
          const machine = await tx.machine.findFirst({
            where: { machineId: BigInt(input.machineId), companyId: company, deletedAt: null },
          });
          if (!machine) throw bomError(BOM_ERROR_CODES.PARENT_ITEM_REQUIRED, 'Machine not found', 'machineId');
          parentId = machine.itemId;
        }
        if (!parentId) {
          throw bomError(BOM_ERROR_CODES.PARENT_ITEM_REQUIRED, 'parentItemId or machineId is required', 'parentItemId');
        }

        const items = await this.repository.loadItems(tx, company, [parentId]);
        const parent = items.get(parentId.toString());
        const procurement = await loadProcurementTypes(tx, company, [parentId]);
        const parentIssues = checkParent(parent, procurement);
        if (parentIssues.length) {
          throw bomError(
            (parentIssues[0].code as keyof typeof BOM_ERROR_CODES) in BOM_ERROR_CODES
              ? (parentIssues[0].code as (typeof BOM_ERROR_CODES)[keyof typeof BOM_ERROR_CODES])
              : BOM_ERROR_CODES.PARENT_NOT_MAKE_ITEM,
            parentIssues[0].message,
            'parentItemId',
          );
        }

        const released = await tx.bom.findFirst({
          where: {
            companyId: company,
            parentItemId: parentId,
            bomType: input.bomType ?? 'MANUFACTURING',
            bomScope: 'STANDARD',
            status: BomStatus.RELEASED,
            deletedAt: null,
            isCurrentVersion: true,
          },
          select: { bomNumber: true },
        });
        if (released) {
          throw bomError(
            BOM_ERROR_CODES.PARENT_HAS_RELEASED_BOM,
            `Item already has released BOM ${released.bomNumber}. Create a revision instead.`,
            'parentItemId',
          );
        }

        const baseQuantity = toDecimal(input.baseQuantity ?? '1') ?? new Prisma.Decimal(1);
        const bomNumber = await this.documentNumbers.reserve(tx, company, 'BOM');
        const created = await tx.bom.create({
          data: {
            companyId: company,
            bomNumber,
            parentItemId: parentId,
            bomType: input.bomType ?? 'MANUFACTURING',
            bomScope: 'STANDARD',
            baseQuantity,
            uomId: BigInt(parent!.inventoryUomId!),
            revisionLabel: input.revisionLabel ?? null,
            remarks: input.remarks ?? 'Loaded from Excel import',
            status: BomStatus.DRAFT,
            sourceType: 'MANUAL',
            createdBy: actorId,
          },
        });
        const bom = await tx.bom.update({ where: { bomId: created.bomId }, data: { rootBomId: created.bomId } });

        const groups = buildImportGroups(rows);
        await this.lines.insertImportGroups(tx, bom, groups, actorId);
        await this.repository.writeHistory(tx, {
          companyId: company,
          bomId: bom.bomId,
          from: null,
          to: BomStatus.DRAFT,
          actorId,
          reason: 'Created from Excel import',
        });
        await this.repository.writeAudit(tx, {
          companyId: company,
          actorId,
          action: 'create',
          entityName: 'Bom',
          entityId: bom.bomId,
          newValue: { bomNumber, source: 'IMPORT', groups: groups.length, importId: input.importId },
        });
        return bom.bomId;
      });

      const summary: ImportSummary = {
        totalRows: rows.length,
        validRows: rows.length,
        invalidRows: 0,
        importedRows: rows.length,
        failedRows: 0,
      };
      await this.importSessions.markCompleted(input.importId, summary);
      await this.auditService.log({
        companyId,
        performedBy: user.sub,
        action: UserAuditAction.create,
        entityName: 'BomImport',
        entityId: input.importId,
        newValue: { ...summary, bomId: bomId.toString() },
      });

      const detail = await this.view.detail(company, bomId, user);
      return serialize({
        importId: input.importId,
        status: 'COMPLETED',
        summary,
        bomId: bomId.toString(),
        bom: detail,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      await this.importSessions.markFailed(input.importId, message);
      throw err;
    }
  }

  private extractRow(raw: Record<string, string>, mapped: Record<string, string>) {
    const get = (field: string) => {
      const header = mapped[field];
      return header ? (raw[header] ?? '').trim() : '';
    };
    return {
      findNumber: get('findNumber'),
      partNumber: get('partNumber'),
      oldCode: get('oldCode'),
      quantity: get('quantity'),
      scrapPercentage: get('scrapPercentage'),
      remarks: get('remarks'),
    };
  }
}

function parseFind(raw: string): { kind: 'MAIN' | 'SUB'; commonKey: string } | null {
  const value = raw.trim();
  if (!value) return null;
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!m) return null;
  const commonKey = String(Number(m[1]));
  return { kind: m[2] !== undefined ? 'SUB' : 'MAIN', commonKey };
}

function buildImportGroups(rows: ImportValidatedRow[]) {
  const groups = new Map<
    string,
    { commonKey: string; main: Record<string, unknown> | null; subLines: Array<Record<string, unknown>> }
  >();

  for (const row of rows) {
    if (row.status !== 'VALID') continue;
    const d = row.data;
    const commonKey = String(d.commonKey);
    const line = {
      componentItemId: String(d.componentItemId),
      quantity: String(d.quantity),
      scrapPercentage: String(d.scrapPercentage ?? '0'),
      findNumber: String(d.findNumber),
      remarks: d.remarks ? String(d.remarks) : undefined,
    };
    const g = groups.get(commonKey) ?? { commonKey, main: null, subLines: [] };
    if (d.lineType === 'MAIN') g.main = line;
    else g.subLines.push(line);
    groups.set(commonKey, g);
  }

  const ordered = [...groups.values()].sort((a, b) => Number(a.commonKey) - Number(b.commonKey));
  for (const g of ordered) {
    if (!g.main) {
      throw new BusinessException(
        `MAIN line missing for Key ${g.commonKey}`,
        HttpStatus.BAD_REQUEST,
        undefined,
        'SUB_WITHOUT_MAIN',
      );
    }
  }
  return ordered.map((g) => ({
    commonKey: g.commonKey,
    main: g.main as never,
    subLines: g.subLines as never[],
  }));
}
