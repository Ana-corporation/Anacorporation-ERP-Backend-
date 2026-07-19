import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { CreateVendorDto, UpdateVendorDto } from './dto/vendor.dto';

const VENDORS_LIST_FILTER: ListFilterOptions = {
  contains: { code: 'vendorCode', name: 'name', email: 'email' },
  booleans: { isActive: 'isActive' },
  dateRange: { field: 'createdAt' },
  searchFields: ['vendorCode', 'name', 'email', 'phone', 'city', 'country'],
  sortFields: ['vendorCode', 'name', 'createdAt'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class VendorsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByCompany(companyId: string, query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = buildListWhere(
      { companyId: parseBigIntId(companyId), deletedAt: null },
      query,
      VENDORS_LIST_FILTER,
    ) as Prisma.VendorWhereInput;

    return this.prisma
      .$transaction([
        this.prisma.vendor.findMany({
          where,
          skip,
          take: limit,
          orderBy: resolveOrderBy(query, VENDORS_LIST_FILTER),
        }),
        this.prisma.vendor.count({ where }),
      ])
      .then(([items, total]) => ({ items, total, page, limit }));
  }

  findById(id: string, companyId: string) {
    return this.prisma.vendor.findFirst({
      where: {
        vendorId: parseBigIntId(id),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
    });
  }

  findByCode(companyId: string, vendorCode: string) {
    return this.prisma.vendor.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        vendorCode,
        deletedAt: null,
      },
    });
  }

  create(companyId: string, dto: CreateVendorDto, createdBy?: string) {
    return this.prisma.vendor.create({
      data: {
        companyId: parseBigIntId(companyId),
        vendorCode: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        email: dto.email?.trim() || null,
        phone: dto.phone?.trim() || null,
        address: dto.address?.trim() || null,
        city: dto.city?.trim() || null,
        country: dto.country?.trim() || null,
        taxId: dto.taxId?.trim() || null,
        isActive: dto.isActive ?? true,
        metadata: (dto.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
      },
    });
  }

  update(id: string, dto: UpdateVendorDto, updatedBy?: string) {
    return this.prisma.vendor.update({
      where: { vendorId: parseBigIntId(id) },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.address !== undefined ? { address: dto.address } : {}),
        ...(dto.city !== undefined ? { city: dto.city } : {}),
        ...(dto.country !== undefined ? { country: dto.country } : {}),
        ...(dto.taxId !== undefined ? { taxId: dto.taxId } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.metadata !== undefined
          ? { metadata: dto.metadata as Prisma.InputJsonValue }
          : {}),
        updatedBy: updatedBy ? parseBigIntId(updatedBy) : undefined,
        updatedAt: new Date(),
      },
    });
  }

  softDelete(id: string, deletedBy?: string) {
    return this.prisma.vendor.update({
      where: { vendorId: parseBigIntId(id) },
      data: {
        deletedAt: new Date(),
        deletedBy: deletedBy ? parseBigIntId(deletedBy) : undefined,
        isActive: false,
      },
    });
  }
}
