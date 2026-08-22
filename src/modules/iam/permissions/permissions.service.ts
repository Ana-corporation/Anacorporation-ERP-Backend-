import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId, serialize } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { PERMISSIONS } from '@/common/constants/permissions.constant';

const PERMISSIONS_LIST_FILTER: ListFilterOptions = {
  contains: { code: 'permissionCode', name: 'permissionName' },
  exact: { moduleId: 'moduleId', action: 'action' },
  searchFields: ['permissionCode', 'permissionName', 'action'],
  sortFields: ['permissionCode', 'permissionName', 'createdAt', 'action'],
  defaultSortField: 'permissionCode',
};

const CATALOG_META = new Map(
  PERMISSIONS.map((p) => [
    p.code,
    {
      moduleCode: p.module,
      resource: 'resource' in p ? ((p as { resource?: string | null }).resource ?? null) : null,
      resourceDisplayName:
        'resourceDisplayName' in p
          ? ((p as { resourceDisplayName?: string | null }).resourceDisplayName ?? null)
          : null,
      action: p.action,
      displayName: p.name,
    },
  ]),
);

function enrichPermissionRow(row: {
  permissionCode: string;
  permissionName: string;
  action: string;
  module?: { moduleCode?: string; moduleName?: string } | null;
}) {
  const meta = CATALOG_META.get(row.permissionCode as (typeof PERMISSIONS)[number]['code']);
  return {
    ...row,
    moduleCode: meta?.moduleCode ?? row.module?.moduleCode ?? null,
    resource: meta?.resource ?? null,
    resourceDisplayName: meta?.resourceDisplayName ?? null,
    displayName: meta?.displayName ?? row.permissionName,
    actionDisplayName: row.action
      ? `${row.action.charAt(0).toUpperCase()}${row.action.slice(1)}`
      : null,
  };
}

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
    return serialize(
      toPaginatedResult(items.map(enrichPermissionRow), total, page, limit),
    );
  }

  async findOne(id: string) {
    const permission = await this.prisma.permission.findUnique({
      where: { permissionId: parseBigIntId(id) },
      include: { module: true },
    });
    return serialize(permission ? enrichPermissionRow(permission) : permission);
  }
}
