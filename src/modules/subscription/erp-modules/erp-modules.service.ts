import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { ConflictException, NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { CreateErpModuleDto, UpdateErpModuleDto } from './dto/erp-module.dto';
import { ErpModulesRepository } from './erp-modules.repository';

@Injectable()
export class ErpModulesService {
  constructor(
    private readonly repository: ErpModulesRepository,
    private readonly auditService: AuditService,
  ) {}

  async findAll(query: PaginationQueryDto) {
    const { items, total, page, limit } = await this.repository.findMany(query);
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async findOne(id: string) {
    const mod = await this.repository.findById(id);
    if (!mod) throw new NotFoundException('Module');
    return serialize(mod);
  }

  async create(dto: CreateErpModuleDto, actorId?: string) {
    const code = dto.moduleCode.trim().toLowerCase();
    const existing = await this.repository.findByCode(code);
    if (existing) throw new ConflictException('Module code already exists');

    if (dto.parentModuleId) {
      const parent = await this.repository.findById(dto.parentModuleId);
      if (!parent) throw new NotFoundException('Parent module');
    }

    const mod = await this.repository.create({ ...dto, moduleCode: code }, actorId);

    await this.auditService.log({
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'Module',
      entityId: mod.moduleId.toString(),
      newValue: { moduleCode: code, moduleName: mod.moduleName },
    });

    return serialize(mod);
  }

  async update(id: string, dto: UpdateErpModuleDto, actorId?: string) {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundException('Module');

    if (dto.parentModuleId && dto.parentModuleId !== id) {
      const parent = await this.repository.findById(dto.parentModuleId);
      if (!parent) throw new NotFoundException('Parent module');
    }

    const mod = await this.repository.update(id, dto, actorId);

    await this.auditService.log({
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'Module',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return serialize(mod);
  }

  async remove(id: string, actorId?: string) {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundException('Module');

    await this.repository.softDelete(id, actorId);

    await this.auditService.log({
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'Module',
      entityId: id,
    });

    return { message: 'Module deleted' };
  }
}
