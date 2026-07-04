import { Injectable } from '@nestjs/common';
import { Product, Prisma, AuditAction } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { BaseTenantRepository } from '@/common/repositories/base-tenant.repository';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { withTenant } from '@/common/utils/prisma.helpers';
import { NotFoundException, ConflictException } from '@/common/exceptions/business.exception';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';

@Injectable()
export class ProductsRepository extends BaseTenantRepository<
  Product,
  Prisma.ProductCreateInput,
  Prisma.ProductUpdateInput
> {
  protected readonly modelName = 'product' as const;

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  findByIdWithCategory(organizationId: string, id: string) {
    return this.prisma.product.findFirst({
      where: withTenant(organizationId, { id }),
      include: { category: true },
    });
  }
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly repository: ProductsRepository,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  findAll(organizationId: string, query: PaginationQueryDto) {
    return this.repository.findAllPaginated(organizationId, query, ['sku', 'name']);
  }

  async findOne(organizationId: string, id: string) {
    const product = await this.repository.findByIdWithCategory(organizationId, id);
    if (!product) throw new NotFoundException('Product');
    return product;
  }

  async create(organizationId: string, dto: CreateProductDto, actorId: string) {
    const existing = await this.prisma.product.findFirst({
      where: withTenant(organizationId, { sku: dto.sku }),
    });
    if (existing) throw new ConflictException('Product SKU already exists');

    const product = await this.repository.create(organizationId, {
      sku: dto.sku,
      name: dto.name,
      description: dto.description,
      unitOfMeasure: dto.unitOfMeasure,
      unitCost: dto.unitCost,
      unitPrice: dto.unitPrice,
      isManufactured: dto.isManufactured,
      isPurchasable: dto.isPurchasable,
      isSaleable: dto.isSaleable,
      metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
      category: dto.categoryId ? { connect: { id: dto.categoryId } } : undefined,
    } as Prisma.ProductCreateInput);

    await this.auditService.log({
      organizationId,
      actorId,
      action: AuditAction.CREATE,
      entityType: 'Product',
      entityId: product.id,
      newValues: dto as unknown as Record<string, unknown>,
    });

    return product;
  }

  async update(organizationId: string, id: string, dto: UpdateProductDto, actorId: string) {
    await this.findOne(organizationId, id);

    const product = await this.repository.update(organizationId, id, {
      name: dto.name,
      description: dto.description,
      unitOfMeasure: dto.unitOfMeasure,
      unitCost: dto.unitCost,
      unitPrice: dto.unitPrice,
      isActive: dto.isActive,
      isManufactured: dto.isManufactured,
      isPurchasable: dto.isPurchasable,
      isSaleable: dto.isSaleable,
      metadata: dto.metadata as Prisma.InputJsonValue,
      category: dto.categoryId ? { connect: { id: dto.categoryId } } : undefined,
    });

    await this.auditService.log({
      organizationId,
      actorId,
      action: AuditAction.UPDATE,
      entityType: 'Product',
      entityId: id,
      newValues: dto as unknown as Record<string, unknown>,
    });

    return product;
  }

  async remove(organizationId: string, id: string, actorId: string) {
    await this.findOne(organizationId, id);
    await this.repository.softDelete(organizationId, id);

    await this.auditService.log({
      organizationId,
      actorId,
      action: AuditAction.DELETE,
      entityType: 'Product',
      entityId: id,
    });

    return { message: 'Product deleted' };
  }
}
