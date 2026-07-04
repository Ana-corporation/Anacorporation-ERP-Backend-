import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { CreateCurrencyDto, UpdateCurrencyDto } from './dto/currency.dto';

const CURRENCIES_LIST_FILTER: ListFilterOptions = {
  contains: { code: 'code', name: 'name' },
  booleans: { isActive: 'isActive' },
  dateRange: { field: 'createdAt' },
  searchFields: ['code', 'name'],
  sortFields: ['code', 'name', 'createdAt', 'isActive'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class CurrenciesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMany(query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = buildListWhere({ deletedAt: null }, query, CURRENCIES_LIST_FILTER) as Prisma.CurrencyWhereInput;

    return this.prisma.$transaction([
      this.prisma.currency.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, CURRENCIES_LIST_FILTER),
      }),
      this.prisma.currency.count({ where }),
    ]).then(([items, total]) => ({ items, total, page, limit }));
  }

  findById(id: string) {
    return this.prisma.currency.findFirst({
      where: { currencyId: parseBigIntId(id), deletedAt: null },
    });
  }

  findByCode(code: string) {
    return this.prisma.currency.findFirst({
      where: { code: code.toUpperCase(), deletedAt: null },
    });
  }

  create(dto: CreateCurrencyDto) {
    return this.prisma.currency.create({
      data: {
        code: dto.code.toUpperCase(),
        name: dto.name.trim(),
        symbol: dto.symbol,
        decimalPlaces: dto.decimalPlaces ?? 2,
        isActive: dto.isActive ?? true,
      },
    });
  }

  update(id: string, dto: UpdateCurrencyDto) {
    return this.prisma.currency.update({
      where: { currencyId: parseBigIntId(id) },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.symbol !== undefined ? { symbol: dto.symbol } : {}),
        ...(dto.decimalPlaces !== undefined ? { decimalPlaces: dto.decimalPlaces } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        updatedAt: new Date(),
      },
    });
  }

  softDelete(id: string) {
    return this.prisma.currency.update({
      where: { currencyId: parseBigIntId(id) },
      data: { deletedAt: new Date() },
    });
  }
}
