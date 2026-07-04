import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId, serialize } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';

const PERMISSIONS_LIST_FILTER: ListFilterOptions = {
  contains: { code: 'permissionCode', name: 'permissionName' },
  exact: { moduleId: 'moduleId', action: 'action' },
  searchFields: ['permissionCode', 'permissionName', 'action'],
  sortFields: ['permissionCode', 'permissionName', 'createdAt', 'action'],
  defaultSortField: 'permissionCode',
};

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = buildListWhere({}, query, PERMISSIONS_LIST_FILTER) as Prisma.PermissionWhereInput;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.permission.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, PERMISSIONS_LIST_FILTER),
        include: { module: true },
      }),
      this.prisma.permission.count({ where }),
    ]);
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async findOne(id: string) {
    const permission = await this.prisma.permission.findUnique({
      where: { permissionId: parseBigIntId(id) },
      include: { module: true },
    });
    return serialize(permission);
  }
}
