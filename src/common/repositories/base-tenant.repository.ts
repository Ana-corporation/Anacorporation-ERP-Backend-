import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import {
  buildOrSearch,
  softDeleteData,
  withTenant,
} from '@/common/utils/prisma.helpers';
import { getPaginationParams, PaginationQueryDto } from '@/common/dto/pagination.dto';
import { buildSortOrder } from '@/common/utils/helpers';
import { toPaginatedResult } from '@/common/utils/pagination.util';

type PrismaDelegate = {
  findFirst: (args: unknown) => Promise<unknown>;
  findMany: (args: unknown) => Promise<unknown[]>;
  count: (args: unknown) => Promise<number>;
  create: (args: unknown) => Promise<unknown>;
  update: (args: unknown) => Promise<unknown>;
};

@Injectable()
export abstract class BaseTenantRepository<
  TModel extends { id: string; organizationId: string },
  TCreate,
  TUpdate,
> {
  protected abstract readonly modelName: string;

  constructor(protected readonly prisma: PrismaService) {}

  protected get model(): PrismaDelegate {
    return (this.prisma as unknown as Record<string, PrismaDelegate>)[this.modelName];
  }

  async findById(organizationId: string, id: string): Promise<TModel | null> {
    return this.model.findFirst({
      where: withTenant(organizationId, { id }),
    }) as Promise<TModel | null>;
  }

  async findAllPaginated(
    organizationId: string,
    query: PaginationQueryDto,
    searchFields: string[] = [],
  ) {
    const { page, limit, skip } = getPaginationParams(query);
    const where = {
      ...withTenant(organizationId),
      ...buildOrSearch(query.search, searchFields),
    };

    const [items, total] = await Promise.all([
      this.model.findMany({
        where,
        skip,
        take: limit,
        orderBy: buildSortOrder(query.sortBy ?? 'createdAt', query.sortOrder ?? 'desc'),
      }),
      this.model.count({ where }),
    ]);

    return toPaginatedResult(items as TModel[], total, page, limit);
  }

  async create(organizationId: string, data: TCreate): Promise<TModel> {
    return this.model.create({
      data: { ...(data as object), organizationId },
    }) as Promise<TModel>;
  }

  async update(organizationId: string, id: string, data: TUpdate): Promise<TModel> {
    return this.model.update({
      where: { id },
      data,
    }) as Promise<TModel>;
  }

  async softDelete(organizationId: string, id: string): Promise<TModel> {
    return this.model.update({
      where: { id },
      data: softDeleteData(),
    }) as Promise<TModel>;
  }
}
