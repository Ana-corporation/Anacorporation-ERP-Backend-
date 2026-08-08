import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { CreateVendorDto, UpdateVendorDto } from './dto/vendor.dto';
import { formatVendorCode, parseVendorSequence } from './vendor-code.util';

type DbClient = Prisma.TransactionClient | PrismaService;

const VENDORS_LIST_FILTER: ListFilterOptions = {
  contains: { code: 'vendorCode', name: 'name', email: 'email' },
  exact: { supplierType: 'supplierType' },
  booleans: { isActive: 'isActive' },
  dateRange: { field: 'createdAt' },
  searchFields: ['vendorCode', 'name', 'email', 'phone', 'city', 'country', 'supplierType'],
  sortFields: ['vendorCode', 'name', 'supplierType', 'createdAt'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class VendorsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(client?: DbClient): Prisma.TransactionClient {
    return (client ?? this.prisma) as unknown as Prisma.TransactionClient;
  }

  findManyByCompany(
    companyId: string,
    query: PaginationQueryDto,
    recordIdFilter?: bigint[] | null,
  ) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = buildListWhere(
      {
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        ...(recordIdFilter ? { vendorId: { in: recordIdFilter } } : {}),
      },
      query,
      VENDORS_LIST_FILTER,
    ) as Prisma.VendorWhereInput;

    // Empty filter set from CF filters → no matches
    if (recordIdFilter && recordIdFilter.length === 0) {
      return Promise.resolve({ items: [], total: 0, page, limit });
    }

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

  findByCode(companyId: string, vendorCode: string, client: DbClient = this.prisma) {
    return this.db(client).vendor.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        vendorCode,
        deletedAt: null,
      },
    });
  }

  /** Next code for prefix: RM001, CS002, … (ignores legacy "RM001 CSKMETA" style codes). */
  async nextVendorCode(companyId: string, prefix: string, client: DbClient = this.prisma) {
    const existing = await this.db(client).vendor.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        vendorCode: { startsWith: prefix },
      },
      select: { vendorCode: true },
    });

    let maxSeq = 0;
    for (const row of existing) {
      const seq = parseVendorSequence(row.vendorCode, prefix);
      if (seq !== null && seq > maxSeq) maxSeq = seq;
    }

    return formatVendorCode(prefix, maxSeq + 1);
  }

  create(
    companyId: string,
    dto: Omit<CreateVendorDto, 'customFields'>,
    vendorCode: string,
    createdBy?: string,
    client: DbClient = this.prisma,
  ) {
    return this.db(client).vendor.create({
      data: {
        companyId: parseBigIntId(companyId),
        vendorCode,
        supplierType: dto.supplierType,
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

  update(
    id: string,
    dto: UpdateVendorDto,
    updatedBy?: string,
    client: DbClient = this.prisma,
  ) {
    return this.db(client).vendor.update({
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
