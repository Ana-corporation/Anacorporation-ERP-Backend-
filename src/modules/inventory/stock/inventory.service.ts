import { Injectable } from '@nestjs/common';
import { AuditAction, InventoryTransactionType, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { EventsGateway } from '@/infrastructure/websocket/events.gateway';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { withTenant } from '@/common/utils/prisma.helpers';
import { buildSortOrder } from '@/common/utils/helpers';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import {
  BusinessException,
  ConflictException,
  NotFoundException,
} from '@/common/exceptions/business.exception';
import {
  CreateInventoryItemDto,
  CreateWarehouseDto,
  InventoryTransactionDto,
} from './dto/inventory.dto';

@Injectable()
export class InventoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  findWarehouses(organizationId: string) {
    return this.prisma.warehouse.findMany({
      where: withTenant(organizationId),
      orderBy: { name: 'asc' },
    });
  }

  findItemsPaginated(organizationId: string, query: PaginationQueryDto) {
    const { page, limit, skip } = getPaginationParams(query);
    const where = withTenant(organizationId);

    return Promise.all([
      this.prisma.inventoryItem.findMany({
        where,
        include: { product: true, warehouse: true },
        skip,
        take: limit,
        orderBy: buildSortOrder(query.sortBy ?? 'createdAt', query.sortOrder ?? 'desc'),
      }),
      this.prisma.inventoryItem.count({ where }),
    ]).then(([items, total]) => toPaginatedResult(items, total, page, limit));
  }

  findItemById(organizationId: string, id: string) {
    return this.prisma.inventoryItem.findFirst({
      where: withTenant(organizationId, { id }),
      include: { product: true, warehouse: true },
    });
  }

  findTransactions(organizationId: string, inventoryItemId: string) {
    return this.prisma.inventoryTransaction.findMany({
      where: { organizationId, inventoryItemId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: InventoryRepository,
    private readonly auditService: AuditService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  listWarehouses(organizationId: string) {
    return this.repository.findWarehouses(organizationId);
  }

  async createWarehouse(organizationId: string, dto: CreateWarehouseDto, actorId: string) {
    const existing = await this.prisma.warehouse.findFirst({
      where: withTenant(organizationId, { code: dto.code }),
    });
    if (existing) throw new ConflictException('Warehouse code already exists');

    const warehouse = await this.prisma.warehouse.create({
      data: { organizationId, ...dto },
    });

    await this.auditService.log({
      organizationId,
      actorId,
      action: AuditAction.CREATE,
      entityType: 'Warehouse',
      entityId: warehouse.id,
      newValues: dto as unknown as Record<string, unknown>,
    });

    return warehouse;
  }

  listItems(organizationId: string, query: PaginationQueryDto) {
    return this.repository.findItemsPaginated(organizationId, query);
  }

  async getItem(organizationId: string, id: string) {
    const item = await this.repository.findItemById(organizationId, id);
    if (!item) throw new NotFoundException('Inventory item');
    return item;
  }

  async createItem(organizationId: string, dto: CreateInventoryItemDto, actorId: string) {
    const product = await this.prisma.product.findFirst({
      where: withTenant(organizationId, { id: dto.productId }),
    });
    if (!product) throw new NotFoundException('Product');

    const warehouse = await this.prisma.warehouse.findFirst({
      where: withTenant(organizationId, { id: dto.warehouseId }),
    });
    if (!warehouse) throw new NotFoundException('Warehouse');

    const existing = await this.prisma.inventoryItem.findFirst({
      where: withTenant(organizationId, {
        productId: dto.productId,
        warehouseId: dto.warehouseId,
      }),
    });
    if (existing) throw new ConflictException('Inventory item already exists for product/warehouse');

    const item = await this.prisma.inventoryItem.create({
      data: {
        organizationId,
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        reorderPoint: dto.reorderPoint,
        reorderQuantity: dto.reorderQuantity,
      },
      include: { product: true, warehouse: true },
    });

    await this.auditService.log({
      organizationId,
      actorId,
      action: AuditAction.CREATE,
      entityType: 'InventoryItem',
      entityId: item.id,
      newValues: dto as unknown as Record<string, unknown>,
    });

    return item;
  }

  async recordTransaction(
    organizationId: string,
    dto: InventoryTransactionDto,
    actorId: string,
  ) {
    const item = await this.getItem(organizationId, dto.inventoryItemId);

    return this.prisma.$transaction(async (tx) => {
      const quantityDelta = this.calculateQuantityDelta(dto.type, dto.quantity);
      const newQuantity = new Decimal(item.quantityOnHand).add(quantityDelta);

      if (newQuantity.lessThan(0)) {
        throw new BusinessException('Insufficient inventory quantity');
      }

      const updatedItem = await tx.inventoryItem.update({
        where: { id: item.id },
        data: {
          quantityOnHand: newQuantity,
          ...(dto.type === InventoryTransactionType.RESERVATION
            ? { quantityReserved: { increment: dto.quantity } }
            : {}),
          ...(dto.type === InventoryTransactionType.RELEASE
            ? { quantityReserved: { decrement: dto.quantity } }
            : {}),
        },
        include: { product: true, warehouse: true },
      });

      const transaction = await tx.inventoryTransaction.create({
        data: {
          organizationId,
          inventoryItemId: item.id,
          warehouseId: item.warehouseId,
          type: dto.type,
          quantity: dto.quantity,
          referenceType: dto.referenceType,
          referenceId: dto.referenceId,
          notes: dto.notes,
          performedById: actorId,
        },
      });

      await this.auditService.log({
        organizationId,
        actorId,
        action: AuditAction.UPDATE,
        entityType: 'InventoryItem',
        entityId: item.id,
        newValues: {
          type: dto.type,
          quantity: dto.quantity,
          newQuantityOnHand: newQuantity.toString(),
        },
      });

      this.eventsGateway.emitInventoryUpdate(organizationId, {
        inventoryItemId: item.id,
        quantityOnHand: updatedItem.quantityOnHand,
        transaction,
      });

      return { item: updatedItem, transaction };
    });
  }

  getTransactions(organizationId: string, inventoryItemId: string) {
    return this.repository.findTransactions(organizationId, inventoryItemId);
  }

  private calculateQuantityDelta(type: InventoryTransactionType, quantity: number): Decimal {
    switch (type) {
      case InventoryTransactionType.RECEIPT:
      case InventoryTransactionType.RELEASE:
        return new Decimal(quantity);
      case InventoryTransactionType.ISSUE:
      case InventoryTransactionType.RESERVATION:
        return new Decimal(quantity).neg();
      case InventoryTransactionType.ADJUSTMENT:
        return new Decimal(quantity);
      case InventoryTransactionType.TRANSFER:
        return new Decimal(quantity).neg();
      default:
        return new Decimal(0);
    }
  }
}
