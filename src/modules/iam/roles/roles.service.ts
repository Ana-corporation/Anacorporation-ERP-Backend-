import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { ConflictException, NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import {
  CloneRoleDto,
  CreateRoleDto,
  SetRolePermissionsDto,
  UpdateRoleDto,
} from './dto/role.dto';
import { RolesRepository } from './roles.repository';

@Injectable()
export class RolesService {
  constructor(
    private readonly repository: RolesRepository,
    private readonly auditService: AuditService,
  ) {}

  private mapPermissions(
    role: NonNullable<Awaited<ReturnType<RolesRepository['findById']>>>,
  ) {
    return role.rolePermissions
      .filter((rp) => rp.isAllowed)
      .map((rp) => ({
        permissionId: rp.permissionId.toString(),
        permissionCode: rp.permission.permissionCode,
        moduleId: rp.moduleId.toString(),
        action: rp.permission.action,
        isAllowed: rp.isAllowed,
      }));
  }

  async findAll(companyId: string, query: PaginationQueryDto) {
    const { items, total, page, limit } = await this.repository.findManyByCompany(companyId, query);
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async findOne(id: string, companyId: string) {
    const role = await this.repository.findById(id, companyId);
    if (!role) throw new NotFoundException('Role');
    return serialize(role);
  }

  async getPermissions(id: string, companyId: string) {
    const role = await this.repository.findById(id, companyId);
    if (!role) throw new NotFoundException('Role');
    return serialize(this.mapPermissions(role));
  }

  async create(companyId: string, dto: CreateRoleDto, actorId: string) {
    const existing = await this.repository.findByCode(companyId, dto.roleCode.toUpperCase());
    if (existing) throw new ConflictException('Role code already exists');

    const role = await this.repository.create(companyId, dto, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'Role',
      entityId: role.roleId.toString(),
    });

    return serialize(role);
  }

  async clone(id: string, companyId: string, dto: CloneRoleDto, actorId: string) {
    const source = await this.repository.findById(id, companyId);
    if (!source) throw new NotFoundException('Role');

    const existing = await this.repository.findByCode(companyId, dto.roleCode.toUpperCase());
    if (existing) throw new ConflictException('Role code already exists');

    const role = await this.repository.cloneRole(
      id,
      companyId,
      {
        roleCode: dto.roleCode,
        roleName: dto.roleName,
        description: dto.description ?? source.description ?? undefined,
      },
      actorId,
    );
    if (!role) throw new NotFoundException('Role');

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'Role',
      entityId: role.roleId.toString(),
      newValue: { clonedFrom: id },
    });

    return serialize(role);
  }

  async update(id: string, companyId: string, dto: UpdateRoleDto, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw new NotFoundException('Role');

    const role = await this.repository.update(id, dto, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'Role',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return serialize(role);
  }

  async remove(id: string, companyId: string, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw new NotFoundException('Role');
    if (existing.isSystem) throw new ConflictException('System roles cannot be deleted');

    const assigned = await this.repository.countUsersWithRole(id, companyId);
    if (assigned > 0) {
      throw new ConflictException('Cannot delete role while users are assigned');
    }

    await this.repository.softDelete(id, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'Role',
      entityId: id,
    });

    return { message: 'Role deleted' };
  }

  async setPermissions(id: string, companyId: string, dto: SetRolePermissionsDto, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw new NotFoundException('Role');

    let permissionIds = dto.permissionIds ?? [];

    if ((!permissionIds || permissionIds.length === 0) && dto.permissionCodes?.length) {
      const rows = await this.repository.findPermissionsByCodes(dto.permissionCodes);
      permissionIds = rows.map((p) => p.permissionId.toString());
    }

    if ((!permissionIds || permissionIds.length === 0) && dto.permissions?.length) {
      const rows = await this.repository.findPermissionsByModuleActions(dto.permissions);
      permissionIds = rows.map((p) => p.permissionId.toString());
    }

    if (!permissionIds.length) {
      throw new ConflictException('No matching permissions found');
    }

    const role = await this.repository.setPermissions(id, permissionIds, actorId);
    if (!role) throw new NotFoundException('Role');

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'RolePermission',
      entityId: id,
      newValue: {
        permissionIds,
        permissionCodes: dto.permissionCodes,
      },
    });

    return serialize(this.mapPermissions(role));
  }
}
