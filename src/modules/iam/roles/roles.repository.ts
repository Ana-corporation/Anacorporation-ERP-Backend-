import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';

const ROLES_LIST_FILTER: ListFilterOptions = {
  contains: { code: 'roleCode', name: 'roleName' },
  dateRange: { field: 'createdAt' },
  searchFields: ['roleCode', 'roleName', 'description'],
  sortFields: ['roleCode', 'roleName', 'createdAt'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class RolesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByCompany(companyId: string, query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = buildListWhere(
      { companyId: parseBigIntId(companyId), deletedAt: null },
      query,
      ROLES_LIST_FILTER,
    ) as Prisma.RoleWhereInput;

    return this.prisma.$transaction([
      this.prisma.role.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, ROLES_LIST_FILTER),
        include: {
          rolePermissions: { include: { permission: true } },
        },
      }),
      this.prisma.role.count({ where }),
    ]).then(([items, total]) => ({ items, total, page, limit }));
  }

  findById(id: string, companyId: string) {
    return this.prisma.role.findFirst({
      where: {
        roleId: parseBigIntId(id),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
      include: {
        rolePermissions: { include: { permission: true, module: true } },
      },
    });
  }

  findByCode(companyId: string, roleCode: string) {
    return this.prisma.role.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        roleCode,
        deletedAt: null,
      },
    });
  }

  create(companyId: string, dto: CreateRoleDto, createdBy?: string) {
    return this.prisma.role.create({
      data: {
        companyId: parseBigIntId(companyId),
        roleCode: dto.roleCode.trim().toUpperCase(),
        roleName: dto.roleName.trim(),
        description: dto.description,
        createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
      },
    });
  }

  update(id: string, dto: UpdateRoleDto, updatedBy?: string) {
    return this.prisma.role.update({
      where: { roleId: parseBigIntId(id) },
      data: {
        ...(dto.roleName !== undefined ? { roleName: dto.roleName.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        updatedBy: updatedBy ? parseBigIntId(updatedBy) : undefined,
        updatedAt: new Date(),
      },
    });
  }

  softDelete(id: string, deletedBy?: string) {
    return this.prisma.role.update({
      where: { roleId: parseBigIntId(id) },
      data: {
        deletedAt: new Date(),
        deletedBy: deletedBy ? parseBigIntId(deletedBy) : undefined,
      },
    });
  }

  async setPermissions(roleId: string, permissionIds: string[], actorId?: string) {
    const role = await this.prisma.role.findUnique({
      where: { roleId: parseBigIntId(roleId) },
    });
    if (!role) return null;

    await this.prisma.rolePermission.deleteMany({
      where: { roleId: role.roleId },
    });

    const permissions = await this.prisma.permission.findMany({
      where: { permissionId: { in: permissionIds.map((id) => parseBigIntId(id)) } },
    });

    await this.prisma.rolePermission.createMany({
      data: permissions.map((p) => ({
        roleId: role.roleId,
        moduleId: p.moduleId,
        permissionId: p.permissionId,
        isAllowed: true,
        createdBy: actorId ? parseBigIntId(actorId) : undefined,
      })),
    });

    return this.findById(roleId, role.companyId!.toString());
  }

  findPermissionsByCodes(codes: string[]) {
    return this.prisma.permission.findMany({
      where: { permissionCode: { in: codes } },
    });
  }

  findPermissionsByModuleActions(items: { moduleId: string; action: string }[]) {
    return this.prisma.permission.findMany({
      where: {
        OR: items.map((item) => ({
          moduleId: parseBigIntId(item.moduleId),
          action: item.action as never,
        })),
      },
    });
  }

  async cloneRole(
    sourceRoleId: string,
    companyId: string,
    dto: CreateRoleDto,
    createdBy?: string,
  ) {
    const source = await this.findById(sourceRoleId, companyId);
    if (!source) return null;

    const role = await this.create(companyId, dto, createdBy);
    const permissionIds = source.rolePermissions.map((rp) => rp.permissionId.toString());
    if (permissionIds.length > 0) {
      await this.setPermissions(role.roleId.toString(), permissionIds, createdBy);
    }

    return this.findById(role.roleId.toString(), companyId);
  }

  countUsersWithRole(roleId: string, companyId: string) {
    return this.prisma.userRole.count({
      where: {
        roleId: parseBigIntId(roleId),
        companyId: parseBigIntId(companyId),
        isActive: true,
      },
    });
  }
}
