import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { ConflictException, NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { BranchesRepository } from '../branches/branches.repository';
import { CreateWarehouseDto, UpdateWarehouseDto } from './dto/warehouse.dto';
import { WarehousesRepository } from './warehouses.repository';

@Injectable()
export class WarehousesService {
  constructor(
    private readonly repository: WarehousesRepository,
    private readonly branchesRepository: BranchesRepository,
    private readonly auditService: AuditService,
  ) {}

  private async validateBranch(companyId: string, branchId?: string | null) {
    if (!branchId) return;
    const branch = await this.branchesRepository.findById(branchId, companyId);
    if (!branch) throw new NotFoundException('Branch');
  }

  async findAll(companyId: string, query: PaginationQueryDto) {
    const { items, total, page, limit } = await this.repository.findManyByCompany(companyId, query);
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async findOne(id: string, companyId: string) {
    const warehouse = await this.repository.findById(id, companyId);
    if (!warehouse) throw new NotFoundException('Warehouse');
    return serialize(warehouse);
  }

  async create(companyId: string, dto: CreateWarehouseDto, actorId: string) {
    const code = dto.warehouseCode.trim().toUpperCase();
    if (await this.repository.findByCode(companyId, code)) {
      throw new ConflictException('Warehouse code already exists');
    }
    await this.validateBranch(companyId, dto.branchId);

    const warehouse = await this.repository.create(companyId, { ...dto, warehouseCode: code }, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'Warehouse',
      entityId: warehouse.warehouseId.toString(),
      newValue: { warehouseCode: code, name: warehouse.name },
    });

    return serialize(warehouse);
  }

  async update(id: string, companyId: string, dto: UpdateWarehouseDto, actorId: string) {
    if (!(await this.repository.findById(id, companyId))) throw new NotFoundException('Warehouse');
    await this.validateBranch(companyId, dto.branchId);

    const warehouse = await this.repository.update(id, dto, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'Warehouse',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return serialize(warehouse);
  }

  async remove(id: string, companyId: string, actorId: string) {
    if (!(await this.repository.findById(id, companyId))) throw new NotFoundException('Warehouse');

    await this.repository.softDelete(id, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'Warehouse',
      entityId: id,
    });

    return { message: 'Warehouse deleted' };
  }
}
