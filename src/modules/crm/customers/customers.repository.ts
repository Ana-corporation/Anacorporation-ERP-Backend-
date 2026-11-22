import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';

const CUSTOMERS_LIST_FILTER: ListFilterOptions = {
  contains: { code: 'customerCode', name: 'name', email: 'email' },
  exact: { customerType: 'customerType' },
  booleans: { isActive: 'isActive' },
  dateRange: { field: 'createdAt' },
  searchFields: ['customerCode', 'name', 'legalName', 'email', 'phone'],
  sortFields: ['customerCode', 'name', 'createdAt'],
  defaultSortField: 'createdAt',
  tieBreaker: 'customerId',
};

/** Primary tax id + default bill-to city for list/lookup rows. */
const listInclude = {
  taxIdentifiers: {
    where: { isActive: true },
    orderBy: [{ isPrimary: 'desc' }, { customerTaxIdentifierId: 'asc' }],
    take: 1,
    select: { idType: true, idLabel: true, idValue: true },
  },
  addresses: {
    where: { isActive: true },
    orderBy: [{ isDefault: 'desc' }, { addressType: 'asc' }, { customerAddressId: 'asc' }],
    take: 1,
    select: { city: true, region: true, countryCode: true },
  },
  currency: { select: { currencyId: true, code: true, symbol: true, decimalPlaces: true } },
  paymentTerm: { select: { paymentTermId: true, code: true, name: true, days: true } },
} satisfies Prisma.CustomerInclude;

export const detailInclude = {
  taxIdentifiers: { orderBy: [{ isPrimary: 'desc' as const }, { customerTaxIdentifierId: 'asc' as const }] },
  addresses: { orderBy: [{ isDefault: 'desc' as const }, { customerAddressId: 'asc' as const }] },
  contacts: { orderBy: [{ isPrimary: 'desc' as const }, { customerContactId: 'asc' as const }] },
  currency: { select: { currencyId: true, code: true, symbol: true, decimalPlaces: true } },
  paymentTerm: { select: { paymentTermId: true, code: true, name: true, days: true } },
} satisfies Prisma.CustomerInclude;

export type CustomerListRow = Prisma.CustomerGetPayload<{ include: typeof listInclude }>;
export type CustomerDetailRow = Prisma.CustomerGetPayload<{ include: typeof detailInclude }>;

@Injectable()
export class CustomersRepository {
  constructor(readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => fn(tx as unknown as Prisma.TransactionClient));
  }

  findManyByCompany(companyId: string, query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = buildListWhere(
      { companyId: parseBigIntId(companyId), deletedAt: null },
      query,
      CUSTOMERS_LIST_FILTER,
    ) as Prisma.CustomerWhereInput;

    return this.prisma
      .$transaction([
        this.prisma.customer.findMany({
          where,
          skip,
          take: limit,
          orderBy: resolveOrderBy(query, CUSTOMERS_LIST_FILTER),
          include: listInclude,
        }),
        this.prisma.customer.count({ where }),
      ])
      .then(([items, total]) => ({ items, total, page, limit }));
  }

  /** Active customers for dropdowns (code / name / city / primary tax id). */
  lookup(companyId: string, search: string | undefined, limit: number) {
    return this.prisma.customer.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        isActive: true,
        ...(search
          ? {
              OR: [
                { customerCode: { contains: search, mode: 'insensitive' } },
                { name: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      take: limit,
      orderBy: { name: 'asc' },
      include: listInclude,
    });
  }

  findById(id: string, companyId: string) {
    return this.prisma.customer.findFirst({
      where: { customerId: parseBigIntId(id), companyId: parseBigIntId(companyId), deletedAt: null },
      include: detailInclude,
    });
  }
}
