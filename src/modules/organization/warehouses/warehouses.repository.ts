import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { CreateWarehouseDto, UpdateWarehouseDto } from './dto/warehouse.dto';

const WAREHOUSES_LIST_FILTER: ListFilterOptions = {
  contains: { code: 'warehouseCode', name: 'name' },
  booleans: { isActive: 'isActive' },
  dateRange: { field: 'createdAt' },
  searchFields: ['warehouseCode', 'name', 'address'],
  sortFields: ['warehouseCode', 'name', 'createdAt'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class WarehousesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByCompany(companyId: string, query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = buildListWhere(
      { companyId: parseBigIntId(companyId), deletedAt: null },
      query,
      WAREHOUSES_LIST_FILTER,
    ) as Prisma.WarehouseWhereInput;

    return this.prisma.$transaction([
      this.prisma.warehouse.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, WAREHOUSES_LIST_FILTER),
      }),
      this.prisma.warehouse.count({ where }),
    ]).then(([items, total]) => ({ items, total, page, limit }));
  }

  findById(id: string, companyId: string) {
    return this.prisma.warehouse.findFirst({
      where: { warehouseId: parseBigIntId(id), companyId: parseBigIntId(companyId), deletedAt: null },
    });
  }

  findByCode(companyId: string, warehouseCode: string) {
    return this.prisma.warehouse.findFirst({
      where: { companyId: parseBigIntId(companyId), warehouseCode, deletedAt: null },
    });
  }

  countActiveBins(warehouseId: string) {
    return this.prisma.storageBin.count({
      where: {
        warehouseId: parseBigIntId(warehouseId),
        deletedAt: null,
        isActive: true,
      },
    });
  }

  countBins(warehouseId: string) {
    return this.prisma.storageBin.count({
      where: {
        warehouseId: parseBigIntId(warehouseId),
        deletedAt: null,
      },
    });
  }

  create(companyId: string, dto: CreateWarehouseDto & { warehouseCode: string }, createdBy?: string) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.warehouse.updateMany({
          where: { companyId: parseBigIntId(companyId), deletedAt: null, isDefault: true },
          data: { isDefault: false, updatedAt: new Date() },
        });
      }

      return tx.warehouse.create({
        data: {
          companyId: parseBigIntId(companyId),
          warehouseCode: dto.warehouseCode.trim().toUpperCase(),
          name: dto.name.trim(),
          branchId: parseBigIntId(dto.branchId),
          address: dto.address,
          locationType: dto.locationType ?? 'Store',
          binManagement: dto.binManagement ?? false,
          isDefault: dto.isDefault ?? false,
          isActive: dto.isActive ?? true,
          createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
        },
      });
    });
  }

  update(id: string, companyId: string, dto: UpdateWarehouseDto, updatedBy?: string) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault === true) {
        await tx.warehouse.updateMany({
          where: {
            companyId: parseBigIntId(companyId),
            deletedAt: null,
            isDefault: true,
            NOT: { warehouseId: parseBigIntId(id) },
          },
          data: { isDefault: false, updatedAt: new Date() },
        });
      }

      return tx.warehouse.update({
        where: { warehouseId: parseBigIntId(id) },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.branchId !== undefined
            ? { branchId: dto.branchId === null ? null : parseBigIntId(dto.branchId) }
            : {}),
          ...(dto.address !== undefined ? { address: dto.address } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.locationType !== undefined ? { locationType: dto.locationType } : {}),
          ...(dto.binManagement !== undefined ? { binManagement: dto.binManagement } : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
          updatedBy: updatedBy ? parseBigIntId(updatedBy) : undefined,
          updatedAt: new Date(),
        },
      });
    });
  }

  softDelete(id: string, deletedBy?: string) {
    return this.prisma.warehouse.update({
      where: { warehouseId: parseBigIntId(id) },
      data: {
        deletedAt: new Date(),
        deletedBy: deletedBy ? parseBigIntId(deletedBy) : undefined,
        isActive: false,
        isDefault: false,
      },
    });
  }
}
