import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { ConflictException, NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import {
  CreateItemDto,
  UpdateItemDto,
  UpsertItemWarehouseStockDto,
} from './dto/item.dto';
import { ItemsRepository } from './items.repository';

@Injectable()
export class ItemsService {
  constructor(
    private readonly repository: ItemsRepository,
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
    const item = await this.repository.findById(id, companyId);
    if (!item) throw new NotFoundException('Item');
    return serialize(item);
  }

  async create(companyId: string, dto: CreateItemDto, actorId: string) {
    const itemCode = dto.itemCode.trim().toUpperCase();
    if (await this.repository.findByCode(companyId, itemCode)) {
      throw new ConflictException('Item code already exists');
    }
    await this.assertVendorInCompany(companyId, dto.preferredVendorId);

    const item = await this.repository.create(companyId, { ...dto, itemCode }, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'Item',
      entityId: item.itemId.toString(),
      newValue: { itemCode, description: item.description },
    });

    return serialize(item);
  }

  async update(id: string, companyId: string, dto: UpdateItemDto, actorId: string) {
    await this.assertItemExists(id, companyId);
    await this.assertVendorInCompany(companyId, dto.preferredVendorId);

    const item = await this.repository.update(id, dto, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'Item',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return serialize(item);
  }

  async remove(id: string, companyId: string, actorId: string) {
    await this.assertItemExists(id, companyId);
    await this.repository.softDelete(id, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'Item',
      entityId: id,
    });

    return { message: 'Item deleted' };
  }

  async upsertWarehouseStock(
    id: string,
    companyId: string,
    dto: UpsertItemWarehouseStockDto,
    actorId: string,
  ) {
    await this.assertItemExists(id, companyId);

    const warehouse = await this.repository.findWarehouseById(dto.warehouseId, companyId);
    if (!warehouse) throw new NotFoundException('Warehouse');

    const row = await this.repository.upsertWarehouseStock(companyId, id, dto, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'ItemWarehouseStock',
      entityId: row.itemWarehouseStockId.toString(),
      newValue: { ...dto },
    });

    return serialize(row);
  }

  async removeWarehouseStock(
    id: string,
    companyId: string,
    warehouseId: string,
    actorId: string,
  ) {
    await this.assertItemExists(id, companyId);

    const { count } = await this.repository.deleteWarehouseStock(id, warehouseId);
    if (count === 0) throw new NotFoundException('Item warehouse stock');

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'ItemWarehouseStock',
      entityId: id,
      newValue: { warehouseId },
    });

    return { message: 'Item warehouse stock removed' };
  }

  private async assertItemExists(id: string, companyId: string) {
    if (!(await this.repository.findById(id, companyId))) {
      throw new NotFoundException('Item');
    }
  }

  private async assertVendorInCompany(companyId: string, vendorId?: string) {
    if (!vendorId) return;
    if (!(await this.repository.findVendorById(vendorId, companyId))) {
      throw new NotFoundException('Preferred vendor');
    }
  }
}
