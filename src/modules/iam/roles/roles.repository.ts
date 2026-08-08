import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { CloneRoleDto, CreateRoleDto, UpdateRoleDto } from './dto/role.dto';

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

    return this.prisma
      .$transaction([
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
      ])
      .then(([items, total]) => ({ items, total, page, limit }));
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
        isSystem: false,
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

  /**
   * Replace all role permissions by permissionCode list.
   * Works for system + custom roles (caller must not block on isSystem).
   */
  async setPermissionsByCodes(roleId: string, permissionCodes: string[], actorId?: string) {
    const role = await this.prisma.role.findUnique({
      where: { roleId: parseBigIntId(roleId) },
    });
    if (!role) return { role: null, missingCodes: [] as string[] };

    const normalized = [
      ...new Set(permissionCodes.map((c) => c.trim()).filter((c) => c.length > 0)),
    ];

    const permissions =
      normalized.length === 0
        ? []
        : await this.prisma.permission.findMany({
            where: { permissionCode: { in: normalized } },
          });

    const found = new Set(permissions.map((p) => p.permissionCode));
    const missingCodes = normalized.filter((c) => !found.has(c));
    if (missingCodes.length > 0) {
      return { role: null, missingCodes };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: role.roleId } });
      if (permissions.length === 0) return;
      await tx.rolePermission.createMany({
        data: permissions.map((p) => ({
          roleId: role.roleId,
          moduleId: p.moduleId,
          permissionId: p.permissionId,
          isAllowed: true,
          createdBy: actorId ? parseBigIntId(actorId) : undefined,
        })),
      });
    });

    const updated = await this.findById(roleId, role.companyId!.toString());
    return { role: updated, missingCodes: [] as string[] };
  }

  async cloneRole(
    sourceRoleId: string,
    companyId: string,
    dto: CloneRoleDto,
    createdBy?: string,
  ) {
    const source = await this.findById(sourceRoleId, companyId);
    if (!source) return null;

    const newCode = dto.roleCode.trim().toUpperCase();
    const created = await this.prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          companyId: parseBigIntId(companyId),
          roleCode: newCode,
          roleName: dto.roleName.trim(),
          description: dto.description ?? source.description,
          isSystem: false,
          createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
        },
      });

      if (source.rolePermissions.length > 0) {
        await tx.rolePermission.createMany({
          data: source.rolePermissions.map((rp) => ({
            roleId: role.roleId,
            moduleId: rp.moduleId,
            permissionId: rp.permissionId,
            isAllowed: rp.isAllowed,
            createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
          })),
        });
      }

      return role;
    });

    return this.findById(created.roleId.toString(), companyId);
  }

  /** Active users assigned this role in the company (for cache invalidation). */
  findActiveUserIdsByRole(companyId: string, roleId: string) {
    return this.prisma.userRole.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        roleId: parseBigIntId(roleId),
        isActive: true,
      },
      select: { userId: true },
    });
  }
}
