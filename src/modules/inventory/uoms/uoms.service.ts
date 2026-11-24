import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, UserAuditAction } from '@prisma/client';
import { BusinessException } from '@/common/exceptions/business.exception';
import { parseBigIntId, serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { CreateUomDto, UpdateUomDto } from './dto/uom.dto';

export const UOM_ERROR_CODES = {
  NOT_FOUND: 'UOM_NOT_FOUND',
  CODE_EXISTS: 'UOM_CODE_EXISTS',
  IN_USE: 'UOM_IN_USE',
} as const;

const uomSelect = {
  uomId: true,
  companyId: true,
  code: true,
  name: true,
  decimalPlaces: true,
  isActive: true,
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

  /** All non-deleted UOMs (active + inactive), by code. Small list, not paged. */
  async findAll(companyId: string) {
    const rows = await this.prisma.uom.findMany({
      where: { companyId: parseBigIntId(companyId, 'companyId'), deletedAt: null },
      select: uomSelect,
      orderBy: { code: 'asc' },
    });
    const items = await this.auditService.withAuditList(rows.map((r) => this.toRow(r)));
    return toPaginatedResult(items, items.length, 1, Math.max(items.length, 1));
  }

  async findOne(id: string, companyId: string) {
    const row = await this.find(parseBigIntId(companyId, 'companyId'), parseBigIntId(id));
    if (!row) throw notFound();
    return this.auditService.withAudit(this.toRow(row));
  }

  async create(companyId: string, dto: CreateUomDto, actorId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const code = dto.code.trim().toUpperCase();
    await this.assertCodeFree(company, code);
    let created;
    try {
      created = await this.prisma.uom.create({
        data: {
          companyId: company,
          code,
          name: dto.name.trim(),
          decimalPlaces: dto.decimalPlaces ?? 6,
          isActive: dto.isActive ?? true,
          createdBy: BigInt(actorId),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw codeExists();
      throw error;
    }
    await this.audit(companyId, actorId, UserAuditAction.create, created.uomId, { code: created.code, name: created.name });
    return this.findOne(created.uomId.toString(), companyId);
  }

  async update(id: string, companyId: string, dto: UpdateUomDto, actorId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const uomId = parseBigIntId(id);
    if (!(await this.find(company, uomId))) throw notFound();
    const code = dto.code?.trim().toUpperCase();
    if (code) await this.assertCodeFree(company, code, uomId);
    try {
      await this.prisma.uom.update({
        where: { uomId },
        data: {
          ...(code !== undefined ? { code } : {}),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.decimalPlaces !== undefined ? { decimalPlaces: dto.decimalPlaces } : {}),
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
    if (row._count.items > 0) {
      throw new BusinessException(
        'This UOM is used by items; deactivate it instead',
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

  private find(companyId: bigint, uomId: bigint) {
    return this.prisma.uom.findFirst({ where: { uomId, companyId, deletedAt: null }, select: uomSelect });
  }

  private async assertCodeFree(companyId: bigint, code: string, excludeId?: bigint) {
    const clash = await this.prisma.uom.findFirst({
      where: { companyId, code, deletedAt: null, ...(excludeId ? { NOT: { uomId: excludeId } } : {}) },
      select: { uomId: true },
    });
    if (clash) throw codeExists();
  }

  private toRow(row: UomRow) {
    const { _count, ...uom } = row;
    return serialize({ ...uom, itemCount: _count.items }) as Record<string, unknown>;
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
