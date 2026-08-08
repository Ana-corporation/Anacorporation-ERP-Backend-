import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import {
  BusinessException,
  ConflictException,
  NotFoundException,
} from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { UserContextCacheService } from '@/modules/iam/authentication/user-context-cache.service';
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
    private readonly userContextCache: UserContextCacheService,
  ) {}

  async findAll(companyId: string, query: PaginationQueryDto) {
    const { items, total, page, limit } = await this.repository.findManyByCompany(companyId, query);
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async findOne(id: string, companyId: string) {
    const role = await this.repository.findById(id, companyId);
    if (!role) throw new NotFoundException('Role');
    return serialize(role);
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

  async update(id: string, companyId: string, dto: UpdateRoleDto, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw new NotFoundException('Role');

    // System roles keep ERP names — rename blocked (ADMIN and all isSystem).
    if (existing.isSystem && dto.roleName !== undefined) {
      const nextName = dto.roleName.trim();
      if (nextName !== existing.roleName) {
        throw new ConflictException('System roles cannot be renamed');
      }
    }

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

  /**
   * Replace permissions for system OR custom roles.
   * isSystem must NOT block this.
   */
  async setPermissions(id: string, companyId: string, dto: SetRolePermissionsDto, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw new NotFoundException('Role');

    const { role, missingCodes } = await this.repository.setPermissionsByCodes(
      id,
      dto.permissionCodes ?? [],
      actorId,
    );

    if (missingCodes.length > 0) {
      throw new BusinessException(`Unknown permission codes: ${missingCodes.join(', ')}`);
    }
    if (!role) throw new NotFoundException('Role');

    await this.invalidateRoleAssigneeCaches(companyId, id);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'RolePermission',
      entityId: id,
      newValue: { permissionCodes: dto.permissionCodes ?? [] },
    });

    return serialize(role);
  }

  async clone(id: string, companyId: string, dto: CloneRoleDto, actorId: string) {
    const source = await this.repository.findById(id, companyId);
    if (!source) throw new NotFoundException('Role');

    const code = dto.roleCode.trim().toUpperCase();
    const duplicate = await this.repository.findByCode(companyId, code);
    if (duplicate) throw new ConflictException('Role code already exists');

    const cloned = await this.repository.cloneRole(id, companyId, dto, actorId);
    if (!cloned) throw new NotFoundException('Role');

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'Role',
      entityId: cloned.roleId.toString(),
      newValue: {
        clonedFromRoleId: id,
        roleCode: cloned.roleCode,
        roleName: cloned.roleName,
        isSystem: false,
      },
    });

    return serialize(cloned);
  }

  private async invalidateRoleAssigneeCaches(companyId: string, roleId: string) {
    const assignees = await this.repository.findActiveUserIdsByRole(companyId, roleId);
    await Promise.all(
      assignees.map((row) =>
        this.userContextCache.invalidate(row.userId.toString(), companyId),
      ),
    );
  }
}
