/**
 * Real-database test of the opening stock import: upload → review (Matched / Error) → approve
 * (one transaction). The import never creates items; re-upload does not double-post.
 *   RUN_DB_TESTS=1 NODE_ENV=development npx jest opening-stock-import.db --runInBand
 */
import * as ExcelJS from 'exceljs';
import { BusinessException } from '@/common/exceptions/business.exception';
import { resolveDatabaseEnv } from '@/config/resolve-database-env';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { DataAccessPoliciesService } from '@/modules/iam/data-access-policies/data-access-policies.service';
import { ImportSessionService } from '@/modules/imports/import-session.service';
import { CsvParserService } from '@/modules/imports/parsers/csv-parser.service';
import { ExcelParserService } from '@/modules/imports/parsers/excel-parser.service';
import { InventoryDocumentsRepository } from '@/modules/inventory/stock/inventory-documents.repository';
import { InventoryDocumentsService } from '@/modules/inventory/stock/inventory-documents.service';
import { InventoryLineResolverService } from '@/modules/inventory/stock/inventory-line-resolver.service';
import { StockPostingService } from '@/modules/inventory/stock/stock-posting.service';
import { SubcontractorLocationService } from '@/modules/inventory/stock/subcontractor-location.service';
import { WarehousesRepository } from '@/modules/organization/warehouses/warehouses.repository';
import { OPENING_IMPORT_ERROR_CODES } from './opening-stock-import.constants';
import { PART_NOT_FOUND_MESSAGE, PART_REQUIRED_MESSAGE } from './opening-stock-import.evaluator';
import { OpeningStockImportService } from './opening-stock-import.service';

const enabled = process.env.RUN_DB_TESTS === '1';
if (enabled && resolveDatabaseEnv().dbLabel !== 'DEV') {
  throw new Error('Opening stock import DB tests only run against the DEV database (NODE_ENV=development).');
}
const run = enabled ? describe : describe.skip;

type Row = Record<string, any>;

const HEADER = 'Category Code,Part Number,Part Name,Location Code,Qty,Unit Price,Revision';

run('Opening stock import (database)', () => {
  jest.setTimeout(240_000);

  const prisma = new PrismaService();
  const audit = new AuditService(prisma);
  const unrestricted = { isRestricted: false, branchIds: [], departmentIds: [], warehouseIds: [] };
  const scope = { resolveUserDataScope: jest.fn(async () => unrestricted) } as unknown as DataAccessPoliciesService;
  const documents = new InventoryDocumentsService(
    prisma,
    new InventoryDocumentsRepository(prisma),
    new InventoryLineResolverService(scope),
    new StockPostingService(),
    audit,
    new SubcontractorLocationService(new WarehousesRepository(prisma)),
  );
  const service = new OpeningStockImportService(
    prisma,
    new ImportSessionService(prisma, new ExcelParserService(), new CsvParserService()),
    documents,
    audit,
  );
  const actor = '1';
  const companies: bigint[] = [];
  let companyId: string;
  let company: bigint;
  const ids: Record<string, bigint> = {};

  const csv = (lines: string[], name = 'opening.csv') => {
    const buffer = Buffer.from([HEADER, ...lines].join('\n'), 'utf8');
    return { originalname: name, mimetype: 'text/csv', size: buffer.length, buffer } as Express.Multer.File;
  };

  async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
    try {
      await promise;
    } catch (e) {
      if (e instanceof BusinessException) return (e.getResponse() as { code?: string }).code;
      throw e;
    }
    return undefined;
  }

  const balance = async (itemId: bigint, warehouseId: bigint) =>
    (await prisma.stockBalance.findFirst({ where: { itemId, warehouseId } }))?.quantity.toString() ?? null;
  const itemCount = () => prisma.item.count({ where: { companyId: company } });

  async function makeCompany(tag: string) {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const c = await prisma.company.create({ data: { companyCode: `OSIT_${tag}_${stamp}`.slice(0, 30), name: `Opening import ${tag}` } });
    companies.push(c.companyId);
    return c.companyId;
  }

  beforeAll(async () => {
    company = await makeCompany('A');
    companyId = company.toString();
    const bo = (await prisma.storeCategory.create({ data: { companyId: company, name: 'Bought-Out Store', codePrefix: 'BOS', numberSeriesCode: 'BO' } })).storeCategoryId;
    ids.brg = (await prisma.itemGroup.create({ data: { companyId: company, storeCategoryId: bo, name: 'Bearings', categoryCode: 'BRG' } })).itemGroupId;
    ids.wh1 = (await prisma.warehouse.create({ data: { companyId: company, warehouseCode: 'BOS-001', name: 'BO 1' } })).warehouseId;
    ids.wh2 = (await prisma.warehouse.create({ data: { companyId: company, warehouseCode: 'BOS-002', name: 'BO 2' } })).warehouseId;
    const item = async (itemCode: string, description: string) =>
      (await prisma.item.create({ data: { companyId: company, itemCode, description, storeCategoryId: bo, itemGroupId: ids.brg, inventoryJson: { uomName: 'NOS' } } })).itemId;
    ids.bearing = await item('ANABRG00001', 'Bearing 6204');
    ids.seal = await item('ANABRG00002', 'Oil seal');
    ids.doomed = await item('ANABRG00003', 'Bearing to be deleted');

    // Another company with a part number that must never match
    const other = await makeCompany('B');
    await prisma.item.create({ data: { companyId: other, itemCode: 'OTHER-0001', description: 'Other company part' } });
  });

  afterAll(async () => {
    for (const cid of companies) {
      await prisma.stockLedgerEntry.deleteMany({ where: { companyId: cid } });
      await prisma.stockBalance.deleteMany({ where: { companyId: cid } });
      await prisma.openingStockImportBatch.deleteMany({ where: { companyId: cid } });
      await prisma.inventoryDocument.deleteMany({ where: { companyId: cid } });
      await prisma.userAudit.deleteMany({ where: { companyId: cid } });
      await prisma.company.delete({ where: { companyId: cid } });
    }
    await prisma.$disconnect();
  });

  const FILE = [
    'BRG,anabrg00001,,BOS-001,10,5,R1', // matched (case-insensitive)
    'BRG,ANABRG00003,,BOS-001,4,2,', // matched now, deleted before approve
    'BRG,ANABRG0001,,BOS-002,3,1,', // typo -> did you mean ANABRG00001
    ',,Brand new gear,BOS-001,1,1,', // empty part number
    'SF,ANASF99999,,BOS-001,1,1,', // SF that does not exist
    'BRG,OTHER-0001,,BOS-001,1,1,', // other company's part
  ];

  it('missing Part Number column → 400', async () => {
    const bad = Buffer.from('Part Name,Location Code,Qty\nX,BOS-001,1');
    expect(
      await errorCode(service.upload(companyId, actor, { originalname: 'x.csv', mimetype: 'text/csv', size: bad.length, buffer: bad } as Express.Multer.File)),
    ).toBe(OPENING_IMPORT_ERROR_CODES.MISSING_COLUMNS);
  });

  it('preview has only Matched and Error rows; nothing is created', async () => {
    const before = await itemCount();
    const summary: Row = await service.upload(companyId, actor, csv(FILE), '2026-10-01');
    ids.batch = BigInt(summary.batchId);
    expect(summary).toMatchObject({ status: 'VALIDATED', totalRows: 6, matchedRows: 2, errorRows: 4, stockLines: 2, canApprove: true });
    expect(summary).not.toHaveProperty('newRows');
    expect(summary).not.toHaveProperty('itemsToCreate');

    const errors = (await service.listRows(companyId, String(ids.batch), { matchStatus: 'ERROR', page: 1, limit: 50 } as never)).items as Row[];
    const byRow = new Map(errors.map((r) => [r.rowNo, r.errors]));
    expect(byRow.get(4)[0]).toMatchObject({ field: 'partNumber', message: PART_NOT_FOUND_MESSAGE, suggestion: expect.stringMatching(/Did you mean ANABRG00001/) });
    expect(byRow.get(5).find((e: Row) => e.field === 'partNumber')).toMatchObject({ message: PART_REQUIRED_MESSAGE });
    expect(byRow.get(6).some((e: Row) => e.message === PART_NOT_FOUND_MESSAGE)).toBe(true);
    expect(byRow.get(7).some((e: Row) => e.message === PART_NOT_FOUND_MESSAGE)).toBe(true);

    const matched = (await service.listRows(companyId, String(ids.batch), { matchStatus: 'MATCHED', page: 1, limit: 50 } as never)).items as Row[];
    expect(matched[0].matchedItem).toMatchObject({ itemCode: 'ANABRG00001', itemType: 'BRG', uom: null });
    expect(await itemCount()).toBe(before);
    expect(await balance(ids.bearing, ids.wh1)).toBeNull();
  });

  it('error file has row, column, reason and suggestion', async () => {
    const { buffer } = await service.errorReport(companyId, String(ids.batch));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet('Errors')!;
    expect(sheet.getRow(1).values).toEqual([undefined, 'Original Row No', 'Part Number', 'Column', 'Error Reason', 'Suggested Correction']);
    const lines: unknown[][] = [];
    sheet.eachRow((r, n) => n > 1 && lines.push((r.values as unknown[]).slice(1)));
    expect(lines).toEqual(
      expect.arrayContaining([[4, 'ANABRG0001', 'Part Number', PART_NOT_FOUND_MESSAGE, expect.stringMatching(/Did you mean ANABRG00001/)]]),
    );
  });

  it('approve with good and bad rows: only Matched rows post; an item deleted after the preview is rejected; no item created', async () => {
    const before = await itemCount();
    // The item disappears between preview and approve: approve must reject that row only.
    jest.spyOn(service, 'validateBatch').mockResolvedValueOnce(undefined as never);
    await prisma.item.update({ where: { itemId: ids.doomed }, data: { deletedAt: new Date() } });

    const result: Row = await service.approve(companyId, String(ids.batch), actor);
    expect(result).toMatchObject({ status: 'APPROVED', rejectedAtApprove: 1 });
    expect(result.documentNumber).toMatch(/^OS-/);
    expect(await balance(ids.bearing, ids.wh1)).toBe('10');
    expect(await balance(ids.doomed, ids.wh1)).toBeNull();
    expect(await itemCount()).toBe(before);

    const rejected = await prisma.openingStockImportRow.findFirstOrThrow({ where: { batchId: ids.batch, rowNo: 3 } });
    expect(rejected.matchStatus).toBe('ERROR');
    expect(await errorCode(service.updateRow(companyId, String(ids.batch), String(rejected.rowId), {} as never))).toBe(OPENING_IMPORT_ERROR_CODES.LOCKED);
  });

  it('re-uploading the same approved file does not double-post', async () => {
    const again: Row = await service.upload(companyId, actor, csv(FILE), '2026-10-01');
    expect(again.duplicateOfBatchId).toBe(String(ids.batch));
    const rows = (await service.listRows(companyId, String(again.batchId), { page: 1, limit: 50 } as never)).items as Row[];
    expect(rows[0].errors.map((e: Row) => e.message).join()).toMatch(/already posted/);
    expect(await errorCode(service.approve(companyId, String(again.batchId), actor))).toBe(OPENING_IMPORT_ERROR_CODES.NOT_READY);
    expect(await balance(ids.bearing, ids.wh1)).toBe('10');
  });

  it('a corrected file can be re-imported', async () => {
    const fixed: Row = await service.upload(companyId, actor, csv(['BRG,ANABRG00001,,BOS-002,3,1,', 'BRG,ANABRG00002,,BOS-001,2,0,'], 'fixed.csv'), '2026-10-01');
    expect(fixed).toMatchObject({ matchedRows: 2, errorRows: 0, zeroPriceRows: 1 });
    expect(await errorCode(service.approve(companyId, String(fixed.batchId), actor))).toBe(OPENING_IMPORT_ERROR_CODES.ZERO_PRICE);
    const done: Row = await service.approve(companyId, String(fixed.batchId), actor, { confirmZeroPrice: true });
    expect(done.status).toBe('APPROVED');
    expect(await balance(ids.bearing, ids.wh2)).toBe('3');
    expect(await balance(ids.seal, ids.wh1)).toBe('2');
  });
});
