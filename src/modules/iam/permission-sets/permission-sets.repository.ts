import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, ListFilterOptions, resolveOrderBy } from '@/common/utils/prisma-filter.util';
import {
  CreatePermissionSetDto,
  UpdatePermissionSetDto,
} from './dto/permission-set.dto';

const PERMISSION_SETS_LIST_FILTER: ListFilterOptions = {
  contains: { code: 'code', name: 'name' },
  booleans: { isActive: 'isActive' },
  dateRange: { field: 'createdAt' },
  searchFields: ['code', 'name', 'description'],
  sortFields: ['code', 'name', 'createdAt'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class PermissionSetsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByCompany(companyId: string, query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = buildListWhere(
      { companyId: parseBigIntId(companyId), deletedAt: null },
      query,
      PERMISSION_SETS_LIST_FILTER,
    ) as Prisma.PermissionSetWhereInput;

    return this.prisma
      .$transaction([
        this.prisma.permissionSet.findMany({
          where,
          skip,
          take: limit,
          orderBy: resolveOrderBy(query, PERMISSION_SETS_LIST_FILTER),
          include: {
            permissionSetPermissions: { include: { permission: true } },
          },
        }),
        this.prisma.permissionSet.count({ where }),
      ])
      .then(([items, total]) => ({ items, total, page, limit }));
  }

  findById(id: string, companyId: string) {
    return this.prisma.permissionSet.findFirst({
      where: {
        permissionSetId: parseBigIntId(id),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
      include: {
        permissionSetPermissions: { include: { permission: true } },
      },
    });
  }

  findByCode(companyId: string, code: string) {
    return this.prisma.permissionSet.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        code,
        deletedAt: null,
      },
    });
  }

  findPermissionsByCodes(permissionCodes: string[]): Promise<Array<{ permissionId: bigint; permissionCode: string }>> {
    if (permissionCodes.length === 0) return Promise.resolve([]);
    return this.prisma.permission.findMany({
      where: { permissionCode: { in: permissionCodes } },
      select: { permissionId: true, permissionCode: true },
    });
  }

  create(companyId: string, dto: CreatePermissionSetDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.permissionSet.create({
        data: {
          companyId: parseBigIntId(companyId),
          code: dto.code.trim().toUpperCase(),
          name: dto.name.trim(),
          description: dto.description,
          isActive: dto.isActive ?? true,
          createdBy: parseBigIntId(actorId),
        },
      });

      return created;
    });
  }

  update(id: string, dto: UpdatePermissionSetDto, actorId: string) {
    return this.prisma.permissionSet.update({
      where: { permissionSetId: parseBigIntId(id) },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        updatedBy: parseBigIntId(actorId),
        updatedAt: new Date(),
      },
    });
  }

  softDelete(id: string, actorId: string) {
    return this.prisma.permissionSet.update({
      where: { permissionSetId: parseBigIntId(id) },
      data: {
        deletedAt: new Date(),
        deletedBy: parseBigIntId(actorId),
        isActive: false,
      },
    });
  }

  async replacePermissionSetPermissions(
    permissionSetId: string,
    permissionIds: bigint[],
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.permissionSetPermission.deleteMany({
        where: { permissionSetId: parseBigIntId(permissionSetId) },
      });
      if (permissionIds.length === 0) return;
      await tx.permissionSetPermission.createMany({
        data: permissionIds.map((permissionId) => ({
          permissionSetId: parseBigIntId(permissionSetId),
          permissionId,
        })),
      });
    });
  }

  findRole(roleId: string, companyId: string) {
    return this.prisma.role.findFirst({
      where: {
        roleId: parseBigIntId(roleId),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
    });
  }

  findPermissionSetsByIds(companyId: string, permissionSetIds: string[]) {
    if (permissionSetIds.length === 0) return Promise.resolve([]);
    return this.prisma.permissionSet.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        permissionSetId: { in: permissionSetIds.map((id) => parseBigIntId(id)) },
      },
      select: { permissionSetId: true },
    });
  }

  getRolePermissionSets(roleId: string, companyId: string) {
    return this.prisma.rolePermissionSet.findMany({
      where: {
        roleId: parseBigIntId(roleId),
        role: {
          companyId: parseBigIntId(companyId),
          deletedAt: null,
        },
      },
      include: { permissionSet: true },
      orderBy: { rolePermissionSetId: 'asc' },
    });
  }

  replaceRolePermissionSets(roleId: string, permissionSetIds: string[]) {
    const rid = parseBigIntId(roleId);
    const ids = permissionSetIds.map((id) => parseBigIntId(id));
    return this.prisma.$transaction(async (tx) => {
      await tx.rolePermissionSet.deleteMany({ where: { roleId: rid } });
      if (ids.length === 0) return;
      await tx.rolePermissionSet.createMany({
        data: ids.map((permissionSetId) => ({ roleId: rid, permissionSetId })),
      });
    });
  }
}
