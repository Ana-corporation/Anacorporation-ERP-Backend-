import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, UserAuditAction } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { BusinessException } from '@/common/exceptions/business.exception';
import { parseBigIntId, serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { CreateStoreCategoryDto, UpdateStoreCategoryDto } from './dto/store-category.dto';
import { STORE_CATEGORY_ERROR_CODES } from './store-categories.constants';
import { StoreCategoriesRepository, StoreCategoryRow } from './store-categories.repository';

const notFound = () =>
  new BusinessException('Store category not found', HttpStatus.NOT_FOUND, undefined, STORE_CATEGORY_ERROR_CODES.NOT_FOUND);

const isUniqueViolation = (error: unknown) =>
  (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') ||
  (error instanceof Prisma.PrismaClientUnknownRequestError && error.message.includes('23505'));

@Injectable()
export class StoreCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: StoreCategoriesRepository,
    private readonly auditService: AuditService,
  ) {}

  private inTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction((tx) => fn(tx as unknown as Prisma.TransactionClient));
  }

  /** All non-deleted categories (active + inactive), sortOrder then name. Small list, not paged. */
  async findAll(companyId: string) {
    const rows = await this.repository.list(parseBigIntId(companyId, 'companyId'));
    const items = await this.auditService.withAuditList(rows.map((r) => this.toRow(r)));
    return toPaginatedResult(items, items.length, 1, Math.max(items.length, 1));
  }

  async findOne(id: string, companyId: string) {
    const row = await this.repository.findById(this.prisma, parseBigIntId(companyId, 'companyId'), parseBigIntId(id));
    if (!row) throw notFound();
    return this.auditService.withAudit(this.toRow(row));
  }

  async create(companyId: string, dto: CreateStoreCategoryDto, actorId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const created = await this.withUniqueGuard(company, dto, undefined, (tx) =>
      tx.storeCategory.create({
        data: {
          companyId: company,
          name: dto.name,
          codePrefix: dto.codePrefix,
          description: dto.description ?? null,
          sortOrder: dto.sortOrder ?? 0,
          isActive: dto.isActive ?? true,
          createdBy: BigInt(actorId),
        },
      }),
    );
    await this.audit(companyId, actorId, UserAuditAction.create, created.storeCategoryId, {
      name: created.name,
      codePrefix: created.codePrefix,
    });
    return this.findOne(created.storeCategoryId.toString(), companyId);
  }

  async update(id: string, companyId: string, dto: UpdateStoreCategoryDto, actorId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const categoryId = parseBigIntId(id);
    await this.withUniqueGuard(company, dto, categoryId, async (tx) => {
      await this.repository.lock(tx, company, categoryId);
      const existing = await this.repository.findById(tx, company, categoryId);
      if (!existing) throw notFound();
      if (
        dto.codePrefix !== undefined &&
        dto.codePrefix !== existing.codePrefix &&
        (await this.repository.countLocations(tx, categoryId)) > 0
      ) {
        throw new BusinessException(
          'Code prefix cannot change after location codes were issued with it',
          HttpStatus.BAD_REQUEST,
          [{ field: 'codePrefix', message: 'Locations already use this prefix' }],
          STORE_CATEGORY_ERROR_CODES.PREFIX_LOCKED,
        );
      }
      return tx.storeCategory.update({
        where: { storeCategoryId: categoryId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.codePrefix !== undefined ? { codePrefix: dto.codePrefix } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          updatedBy: BigInt(actorId),
          updatedAt: new Date(),
        },
      });
    });
    await this.audit(companyId, actorId, UserAuditAction.update, categoryId, dto as Record<string, unknown>);
    return this.findOne(id, companyId);
  }

  async remove(id: string, companyId: string, actorId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const categoryId = parseBigIntId(id);
    await this.inTransaction(async (tx) => {
      await this.repository.lock(tx, company, categoryId);
      if (!(await this.repository.findById(tx, company, categoryId))) throw notFound();
      if ((await this.repository.countLocations(tx, categoryId)) > 0) {
        throw new BusinessException(
          'Store category is used by locations; deactivate it instead',
          HttpStatus.CONFLICT,
          undefined,
          STORE_CATEGORY_ERROR_CODES.IN_USE,
        );
      }
      await tx.storeCategory.update({
        where: { storeCategoryId: categoryId },
        data: { deletedAt: new Date(), deletedBy: BigInt(actorId), isActive: false },
      });
    });
    await this.audit(companyId, actorId, UserAuditAction.delete, categoryId);
    return { message: 'Store category deleted' };
  }

  /**
   * Friendly 409s for duplicate name / prefix (checked first, then enforced by the partial
   * unique indexes; a race that hits an index is re-checked to return the right code).
   */
  private async withUniqueGuard<T>(
    companyId: bigint,
    dto: { name?: string; codePrefix?: string },
    excludeId: bigint | undefined,
    write: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const assertUnique = async (tx: Prisma.TransactionClient) => {
      if (dto.name && (await this.repository.findClash(tx, companyId, 'name', dto.name, excludeId))) {
        throw new BusinessException(
          'A store category with this name already exists',
          HttpStatus.CONFLICT,
          [{ field: 'name', message: 'Name already used' }],
          STORE_CATEGORY_ERROR_CODES.NAME_EXISTS,
        );
      }
      if (dto.codePrefix && (await this.repository.findClash(tx, companyId, 'codePrefix', dto.codePrefix, excludeId))) {
        throw new BusinessException(
          'A store category with this code prefix already exists',
          HttpStatus.CONFLICT,
          [{ field: 'codePrefix', message: 'Prefix already used' }],
          STORE_CATEGORY_ERROR_CODES.PREFIX_EXISTS,
        );
      }
    };
    try {
      return await this.inTransaction(async (tx) => {
        await assertUnique(tx);
        return write(tx);
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      await assertUnique(this.prisma as unknown as Prisma.TransactionClient);
      throw error;
    }
  }

  private toRow(row: StoreCategoryRow) {
    const { _count, ...category } = row;
    return serialize({
      storeCategoryId: category.storeCategoryId,
      companyId: category.companyId,
      name: category.name,
      codePrefix: category.codePrefix,
      description: category.description,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      locationCount: _count.warehouses,
      createdBy: category.createdBy,
      createdAt: category.createdAt,
      updatedBy: category.updatedBy,
      updatedAt: category.updatedAt,
    }) as Record<string, unknown>;
  }

  private audit(
    companyId: string,
    actorId: string,
    action: UserAuditAction,
    id: bigint,
    newValue?: Record<string, unknown>,
  ) {
    return this.auditService.log({
      companyId,
      performedBy: actorId,
      action,
      entityName: 'StoreCategory',
      entityId: id.toString(),
      newValue,
    });
  }
}
