import { HttpStatus, Injectable } from '@nestjs/common';
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
import { WarehousesRepository } from '../warehouses/warehouses.repository';
import { CreateStorageBinDto, UpdateStorageBinDto } from './dto/storage-bin.dto';
import { StorageBinsRepository } from './storage-bins.repository';

@Injectable()
export class StorageBinsService {
  constructor(
    private readonly repository: StorageBinsRepository,
    private readonly warehousesRepository: WarehousesRepository,
    private readonly auditService: AuditService,
  ) {}

  private mapBin(bin: Record<string, unknown>) {
    const warehouseId = bin.warehouseId;
    return {
      ...bin,
      inventoryLocationId: warehouseId,
      warehouseId,
    };
  }

  private resolveWarehouseId(dto: CreateStorageBinDto): string {
    return (dto.inventoryLocationId || dto.warehouseId)!;
  }

  async findAll(companyId: string, query: PaginationQueryDto) {
    const { items, total, page, limit } = await this.repository.findManyByCompany(companyId, query);
    const mapped = items.map((item) => this.mapBin(serialize(item) as Record<string, unknown>));
    return toPaginatedResult(mapped, total, page, limit);
  }

  async findOne(id: string, companyId: string) {
    const bin = await this.repository.findById(id, companyId);
    if (!bin) throw new NotFoundException('Storage bin');
    return this.mapBin(serialize(bin) as Record<string, unknown>);
  }

  async create(companyId: string, dto: CreateStorageBinDto, actorId: string) {
    const warehouseId = this.resolveWarehouseId(dto);
    const warehouse = await this.warehousesRepository.findById(warehouseId, companyId);
    if (!warehouse) throw new NotFoundException('Warehouse');
    if (!warehouse.isActive) {
      throw new BusinessException(
        'Cannot create bin on inactive inventory location',
        HttpStatus.BAD_REQUEST,
        undefined,
        'LOCATION_INACTIVE',
      );
    }
    if (!warehouse.binManagement) {
      throw new BusinessException(
        'Bin management is disabled for this inventory location',
        HttpStatus.BAD_REQUEST,
        undefined,
        'BIN_MANAGEMENT_DISABLED',
      );
    }

    const code = dto.binCode.trim().toUpperCase();
    if (await this.repository.findByCode(warehouseId, code)) {
      throw new ConflictException(
        'Bin code must be unique within the inventory location',
        'BIN_CODE_DUPLICATE',
      );
    }

    const bin = await this.repository.create(companyId, warehouseId, { ...dto, binCode: code }, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'StorageBin',
      entityId: bin.storageBinId.toString(),
      newValue: { binCode: code, warehouseId },
    });

    return this.mapBin(serialize(bin) as Record<string, unknown>);
  }

  async update(id: string, companyId: string, dto: UpdateStorageBinDto, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw new NotFoundException('Storage bin');

    if (dto.binCode) {
      const code = dto.binCode.trim().toUpperCase();
      const duplicate = await this.repository.findByCode(existing.warehouseId.toString(), code);
      if (duplicate && duplicate.storageBinId.toString() !== id) {
        throw new ConflictException(
          'Bin code must be unique within the inventory location',
          'BIN_CODE_DUPLICATE',
        );
      }
      dto = { ...dto, binCode: code };
    }

    const bin = await this.repository.update(id, dto, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'StorageBin',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return this.mapBin(serialize(bin) as Record<string, unknown>);
  }

  async remove(id: string, companyId: string, actorId: string) {
    if (!(await this.repository.findById(id, companyId))) throw new NotFoundException('Storage bin');

    await this.repository.softDelete(id, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'StorageBin',
      entityId: id,
    });

    return { message: 'Storage bin deleted' };
  }
}
