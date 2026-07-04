import { Injectable } from '@nestjs/common';
import { Vendor, Prisma, AuditAction } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { BaseTenantRepository } from '@/common/repositories/base-tenant.repository';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { withTenant } from '@/common/utils/prisma.helpers';
import { NotFoundException, ConflictException } from '@/common/exceptions/business.exception';
import { CreateVendorDto, UpdateVendorDto } from './dto/vendor.dto';

@Injectable()
export class VendorsRepository extends BaseTenantRepository<
  Vendor,
  Prisma.VendorCreateInput,
  Prisma.VendorUpdateInput
> {
  protected readonly modelName = 'vendor' as const;

  constructor(prisma: PrismaService) {
    super(prisma);
  }
}

@Injectable()
export class VendorsService {
  constructor(
    private readonly repository: VendorsRepository,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  findAll(organizationId: string, query: PaginationQueryDto) {
    return this.repository.findAllPaginated(organizationId, query, ['code', 'name', 'email']);
  }

  async findOne(organizationId: string, id: string) {
    const vendor = await this.repository.findById(organizationId, id);
    if (!vendor) throw new NotFoundException('Vendor');
    return vendor;
  }

  async create(organizationId: string, dto: CreateVendorDto, actorId: string) {
    const existing = await this.prisma.vendor.findFirst({
      where: withTenant(organizationId, { code: dto.code }),
    });
    if (existing) throw new ConflictException('Vendor code already exists');

    const vendor = await this.repository.create(organizationId, {
      ...dto,
      metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
    } as Prisma.VendorCreateInput);

    await this.auditService.log({
      organizationId,
      actorId,
      action: AuditAction.CREATE,
      entityType: 'Vendor',
      entityId: vendor.id,
      newValues: dto as unknown as Record<string, unknown>,
    });

    return vendor;
  }

  async update(organizationId: string, id: string, dto: UpdateVendorDto, actorId: string) {
    await this.findOne(organizationId, id);
    const vendor = await this.repository.update(organizationId, id, {
      ...dto,
      metadata: dto.metadata as Prisma.InputJsonValue,
    });

    await this.auditService.log({
      organizationId,
      actorId,
      action: AuditAction.UPDATE,
      entityType: 'Vendor',
      entityId: id,
      newValues: dto as unknown as Record<string, unknown>,
    });

    return vendor;
  }

  async remove(organizationId: string, id: string, actorId: string) {
    await this.findOne(organizationId, id);
    await this.repository.softDelete(organizationId, id);

    await this.auditService.log({
      organizationId,
      actorId,
      action: AuditAction.DELETE,
      entityType: 'Vendor',
      entityId: id,
    });

    return { message: 'Vendor deleted' };
  }
}
