import { HttpStatus, Injectable } from '@nestjs/common';
import { InventoryDocumentStatus, Prisma, UserAuditAction } from '@prisma/client';
import { BusinessException } from '@/common/exceptions/business.exception';
import { parseBigIntId, serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { CreateUomDto, resolveDecimalPlaces, UpdateUomDto } from './dto/uom.dto';
import { STANDARD_UOMS } from './uom-standards';

export const UOM_ERROR_CODES = {
  NOT_FOUND: 'UOM_NOT_FOUND',
  CODE_EXISTS: 'UOM_CODE_EXISTS',
  IN_USE: 'UOM_IN_USE',
  SYSTEM_READONLY: 'UOM_SYSTEM_READONLY',
  FIELDS_LOCKED: 'UOM_FIELDS_LOCKED',
} as const;

const uomSelect = {
  uomId: true,
  companyId: true,
  code: true,
  name: true,
  category: true,
  decimalPlaces: true,
  isActive: true,
  isSystem: true,
  createdBy: true,
  createdAt: true,
  updatedBy: true,
  updatedAt: true,
  _count: { select: { items: { where: { deletedAt: null } } } },
} satisfies Prisma.UomSelect;

type UomRow = Prisma.UomGetPayload<{ select: typeof uomSelect }>;

const notFound = () => new BusinessException('UOM not found', HttpStatus.NOT_FOUND, undefined, UOM_ERROR_CODES.NOT_FOUND);

const codeExists = () =>
  new BusinessException(
    'A UOM with this code already exists',
    HttpStatus.CONFLICT,
    [{ field: 'code', message: 'Code already used' }],
    UOM_ERROR_CODES.CODE_EXISTS,
  );

const isUniqueViolation = (error: unknown) =>
  (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') ||
  (error instanceof Prisma.PrismaClientUnknownRequestError && error.message.includes('23505'));

@Injectable()
export class UomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /** All non-deleted UOMs (active + inactive). Ensures standard system units exist. */
  async findAll(companyId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    await this.ensureStandardUoms(company);
    const rows = await this.prisma.uom.findMany({
      where: { companyId: company, deletedAt: null },
      select: uomSelect,
      orderBy: [{ isSystem: 'desc' }, { code: 'asc' }],
    });
    const items = await this.auditService.withAuditList(rows.map((r) => this.toRow(r)));
    return toPaginatedResult(items, items.length, 1, Math.max(items.length, 1));
  }

  async findOne(id: string, companyId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const row = await this.find(company, parseBigIntId(id));
    if (!row) throw notFound();
    const postedLocked = !row.isSystem && (await this.isUsedInPostedStock(company, row));
    return this.auditService.withAudit(this.toRow(row, { postedLocked }));
  }

  /** Custom units only (isSystem=false). Standard catalogue is seeded, not created via API. */
  async create(companyId: string, dto: CreateUomDto, actorId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    await this.ensureStandardUoms(company);
    const code = String(dto.code).trim().toUpperCase();
    await this.assertCodeFree(company, code);
    const decimalPlaces = resolveDecimalPlaces(dto, 6);
    let created;
    try {
      created = await this.prisma.uom.create({
        data: {
          companyId: company,
          code,
          name: dto.name.trim(),
          category: dto.category,
          decimalPlaces,
          isActive: dto.isActive ?? true,
          isSystem: false,
          createdBy: BigInt(actorId),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw codeExists();
      throw error;
    }
    await this.audit(companyId, actorId, UserAuditAction.create, created.uomId, {
      code: created.code,
      name: created.name,
      category: created.category,
      decimalPlaces: created.decimalPlaces,
    });
    return this.findOne(created.uomId.toString(), companyId);
  }

  async update(id: string, companyId: string, dto: UpdateUomDto, actorId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const uomId = parseBigIntId(id);
    const existing = await this.find(company, uomId);
    if (!existing) throw notFound();

    if (existing.isSystem) {
      // System units: activate/deactivate only (name/code/category/decimals locked).
      const tryingLocked =
        dto.code !== undefined ||
        dto.name !== undefined ||
        dto.category !== undefined ||
        dto.decimalPlaces !== undefined ||
        dto.decimalPrecision !== undefined;
      if (tryingLocked) {
        throw new BusinessException(
          'System UOMs are read-only (name, code, category and decimal precision cannot be changed)',
          HttpStatus.BAD_REQUEST,
          undefined,
          UOM_ERROR_CODES.SYSTEM_READONLY,
        );
      }
      if (dto.isActive === undefined) {
        throw new BusinessException(
          'System UOMs are read-only',
          HttpStatus.BAD_REQUEST,
          undefined,
          UOM_ERROR_CODES.SYSTEM_READONLY,
        );
      }
    }

    const code = dto.code?.trim().toUpperCase();
    if (code) await this.assertCodeFree(company, code, uomId);

    const nextDecimal = resolveDecimalPlaces(dto, existing.decimalPlaces);
    const changingCategory = dto.category !== undefined && dto.category !== existing.category;
    const changingDecimals =
      (dto.decimalPlaces !== undefined || dto.decimalPrecision !== undefined) &&
      nextDecimal !== existing.decimalPlaces;

    if (changingCategory || changingDecimals) {
      if (await this.isUsedInPostedStock(company, existing)) {
        throw new BusinessException(
          'Category and decimal precision cannot be changed after this UOM is used in posted stock',
          HttpStatus.CONFLICT,
          [
            ...(changingCategory ? [{ field: 'category', message: 'Locked after posted stock' }] : []),
            ...(changingDecimals ? [{ field: 'decimalPlaces', message: 'Locked after posted stock' }] : []),
          ],
          UOM_ERROR_CODES.FIELDS_LOCKED,
        );
      }
    }

    try {
      await this.prisma.uom.update({
        where: { uomId },
        data: {
          ...(code !== undefined && !existing.isSystem ? { code } : {}),
          ...(dto.name !== undefined && !existing.isSystem ? { name: dto.name } : {}),
          ...(dto.category !== undefined && !existing.isSystem ? { category: dto.category } : {}),
          ...((dto.decimalPlaces !== undefined || dto.decimalPrecision !== undefined) && !existing.isSystem
            ? { decimalPlaces: nextDecimal }
            : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          updatedBy: BigInt(actorId),
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw codeExists();
      throw error;
    }
    await this.audit(companyId, actorId, UserAuditAction.update, uomId, dto as Record<string, unknown>);
    return this.findOne(id, companyId);
  }

  async remove(id: string, companyId: string, actorId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const uomId = parseBigIntId(id);
    const row = await this.find(company, uomId);
    if (!row) throw notFound();
    if (row.isSystem) {
      throw new BusinessException(
        'System UOMs cannot be deleted; deactivate instead',
        HttpStatus.CONFLICT,
        undefined,
        UOM_ERROR_CODES.SYSTEM_READONLY,
      );
    }
    if (await this.isUsedAnywhere(company, row)) {
      throw new BusinessException(
        'This UOM is used by items or documents; deactivate it instead',
        HttpStatus.CONFLICT,
        undefined,
        UOM_ERROR_CODES.IN_USE,
      );
    }
    await this.prisma.uom.update({
      where: { uomId },
      data: { deletedAt: new Date(), deletedBy: BigInt(actorId), isActive: false },
    });
    await this.audit(companyId, actorId, UserAuditAction.delete, uomId);
    return { message: 'UOM deleted' };
  }

  /** Idempotent seed of standard system UOMs for a company. */
  async ensureStandardUoms(companyId: bigint) {
    const existing = await this.prisma.uom.findMany({
      where: { companyId, deletedAt: null, code: { in: STANDARD_UOMS.map((u) => u.code) } },
      select: { code: true },
    });
    const have = new Set(existing.map((e) => e.code));
    const missing = STANDARD_UOMS.filter((u) => !have.has(u.code));
    if (!missing.length) return;
    await this.prisma.uom.createMany({
      data: missing.map((u) => ({
        companyId,
        code: u.code,
        name: u.name,
        category: u.category,
        decimalPlaces: u.decimalPlaces,
        isActive: true,
        isSystem: true,
      })),
      skipDuplicates: true,
    });
  }

  private find(companyId: bigint, uomId: bigint) {
    return this.prisma.uom.findFirst({ where: { uomId, companyId, deletedAt: null }, select: uomSelect });
  }

  private async assertCodeFree(companyId: bigint, code: string, excludeId?: bigint) {
    const clash = await this.prisma.uom.findFirst({
      where: {
        companyId,
        code: { equals: code, mode: 'insensitive' },
        deletedAt: null,
        ...(excludeId ? { NOT: { uomId: excludeId } } : {}),
      },
      select: { uomId: true },
    });
    // Codes are stored uppercase; equals insensitive covers legacy casing.
    if (clash) throw codeExists();
  }

  private async isUsedAnywhere(companyId: bigint, row: UomRow): Promise<boolean> {
    if (row._count.items > 0) return true;
    const [bom, bomLine, machine, docLine, poLine, pr, osImport] = await Promise.all([
      this.prisma.bom.count({ where: { companyId, uomId: row.uomId, deletedAt: null } }),
      this.prisma.bomLine.count({ where: { bom: { companyId, deletedAt: null }, uomId: row.uomId } }),
      this.prisma.machineSettings.count({ where: { companyId, uomId: row.uomId } }),
      this.prisma.inventoryDocumentLine.count({
        where: {
          companyId,
          uom: { equals: row.code, mode: 'insensitive' },
          document: { deletedAt: null },
        },
      }),
      this.prisma.purchaseOrderLine.count({
        where: {
          companyId,
          OR: [{ uomId: row.uomId }, { inventoryUomId: row.uomId }],
        },
      }),
      this.prisma.purchaseRequirement.count({ where: { companyId, uomId: row.uomId } }),
      this.prisma.openingStockImportRow.count({ where: { companyId, uomId: row.uomId } }),
    ]);
    return bom > 0 || bomLine > 0 || machine > 0 || docLine > 0 || poLine > 0 || pr > 0 || osImport > 0;
  }

  private async isUsedInPostedStock(companyId: bigint, row: UomRow): Promise<boolean> {
    const postedLine = await this.prisma.inventoryDocumentLine.count({
      where: {
        companyId,
        uom: { equals: row.code, mode: 'insensitive' },
        document: {
          companyId,
          status: InventoryDocumentStatus.POSTED,
          deletedAt: null,
        },
      },
    });
    if (postedLine > 0) return true;
    // Item linked + any posted stock balance for that item
    const itemIds = await this.prisma.item.findMany({
      where: { companyId, inventoryUomId: row.uomId, deletedAt: null },
      select: { itemId: true },
      take: 5000,
    });
    if (!itemIds.length) return false;
    const bal = await this.prisma.stockBalance.count({
      where: { companyId, itemId: { in: itemIds.map((i) => i.itemId) } },
    });
    return bal > 0;
  }

  private toRow(row: UomRow, opts?: { postedLocked?: boolean }) {
    const { _count, ...uom } = row;
    const postedLocked = opts?.postedLocked ?? false;
    return serialize({
      ...uom,
      /** Spec alias */
      decimalPrecision: uom.decimalPlaces,
      itemCount: _count.items,
      canDelete: !uom.isSystem && _count.items === 0,
      canEditCode: !uom.isSystem,
      canEditName: !uom.isSystem,
      canEditCategory: !uom.isSystem && !postedLocked,
      canEditDecimalPlaces: !uom.isSystem && !postedLocked,
      canDeactivate: true,
    }) as Record<string, unknown>;
  }

  private audit(companyId: string, actorId: string, action: UserAuditAction, id: bigint, newValue?: Record<string, unknown>) {
    return this.auditService.log({
      companyId,
      performedBy: actorId,
      action,
      entityName: 'Uom',
      entityId: id.toString(),
      newValue,
    });
  }
}
