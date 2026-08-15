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
import {
  CreatePermissionSetDto,
  SetRolePermissionSetsDto,
  UpdatePermissionSetDto,
} from './dto/permission-set.dto';
import { PermissionSetsRepository } from './permission-sets.repository';

@Injectable()
export class PermissionSetsService {
  constructor(
    private readonly repository: PermissionSetsRepository,
    private readonly auditService: AuditService,
  ) {}

  async findAll(companyId: string, query: PaginationQueryDto) {
    const { items, total, page, limit } = await this.repository.findManyByCompany(
      companyId,
      query,
    );
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async findOne(id: string, companyId: string) {
    const set = await this.repository.findById(id, companyId);
    if (!set) throw new NotFoundException('Permission set');
    return serialize(set);
  }

  async create(companyId: string, dto: CreatePermissionSetDto, actorId: string) {
    const code = dto.code.trim().toUpperCase();
    if (await this.repository.findByCode(companyId, code)) {
      throw new ConflictException('Permission set code already exists');
    }

    const permissionCodes = [...new Set((dto.permissionCodes ?? []).map((v) => v.trim()))].filter(
      Boolean,
    );
    const permissions = await this.repository.findPermissionsByCodes(permissionCodes);
    const missing = permissionCodes.filter(
      (codeValue) => !permissions.some((row) => row.permissionCode === codeValue),
    );
    if (missing.length > 0) {
      throw new BusinessException(`Unknown permission codes: ${missing.join(', ')}`);
    }

    const created = await this.repository.create(companyId, { ...dto, code }, actorId);
    await this.repository.replacePermissionSetPermissions(
      created.permissionSetId.toString(),
      permissions.map((p) => p.permissionId),
    );

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'PermissionSet',
      entityId: created.permissionSetId.toString(),
      newValue: { code, permissionCodes },
    });

    return this.findOne(created.permissionSetId.toString(), companyId);
  }

  async update(id: string, companyId: string, dto: UpdatePermissionSetDto, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw new NotFoundException('Permission set');

    if (dto.permissionCodes !== undefined) {
      const permissionCodes = [...new Set(dto.permissionCodes.map((v) => v.trim()))].filter(Boolean);
      const permissions = await this.repository.findPermissionsByCodes(permissionCodes);
      const missing = permissionCodes.filter(
        (codeValue) => !permissions.some((row) => row.permissionCode === codeValue),
      );
      if (missing.length > 0) {
        throw new BusinessException(`Unknown permission codes: ${missing.join(', ')}`);
      }
      await this.repository.replacePermissionSetPermissions(
        id,
        permissions.map((p) => p.permissionId),
      );
    }

    await this.repository.update(id, dto, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'PermissionSet',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return this.findOne(id, companyId);
  }

  async remove(id: string, companyId: string, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw new NotFoundException('Permission set');

    await this.repository.softDelete(id, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'PermissionSet',
      entityId: id,
    });

    return { message: 'Permission set deleted' };
  }

  async getRolePermissionSets(companyId: string, roleId: string) {
    const role = await this.repository.findRole(roleId, companyId);
    if (!role) throw new NotFoundException('Role');
    return serialize(await this.repository.getRolePermissionSets(roleId, companyId));
  }

  async setRolePermissionSets(
    companyId: string,
    roleId: string,
    dto: SetRolePermissionSetsDto,
    actorId: string,
  ) {
    const role = await this.repository.findRole(roleId, companyId);
    if (!role) throw new NotFoundException('Role');

    const ids = [...new Set(dto.permissionSetIds ?? [])];
    const existing = await this.repository.findPermissionSetsByIds(companyId, ids);
    if (existing.length !== ids.length) {
      throw new BusinessException('One or more permissionSetIds are invalid for this company');
    }

    await this.repository.replaceRolePermissionSets(roleId, ids);
    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'RolePermissionSet',
      entityId: roleId,
      newValue: { permissionSetIds: ids },
    });

    return serialize(await this.repository.getRolePermissionSets(roleId, companyId));
  }
}
