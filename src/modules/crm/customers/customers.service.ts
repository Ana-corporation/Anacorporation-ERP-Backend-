import { Injectable } from '@nestjs/common';
import { Customer, Prisma } from '@prisma/client';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { BaseTenantRepository } from '@/common/repositories/base-tenant.repository';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { withTenant } from '@/common/utils/prisma.helpers';
import { NotFoundException, ConflictException } from '@/common/exceptions/business.exception';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';

@Injectable()
export class CustomersRepository extends BaseTenantRepository<
  Customer,
  Prisma.CustomerCreateInput,
  Prisma.CustomerUpdateInput
> {
  protected readonly modelName = 'customer' as const;

  constructor(prisma: PrismaService) {
    super(prisma);
  }
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly repository: CustomersRepository,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  findAll(organizationId: string, query: PaginationQueryDto) {
    return this.repository.findAllPaginated(organizationId, query, ['code', 'name', 'email']);
  }

  async findOne(organizationId: string, id: string) {
    const customer = await this.repository.findById(organizationId, id);
    if (!customer) throw new NotFoundException('Customer');
    return customer;
  }

  async create(organizationId: string, dto: CreateCustomerDto, actorId: string) {
    const existing = await this.prisma.customer.findFirst({
      where: withTenant(organizationId, { code: dto.code }),
    });
    if (existing) throw new ConflictException('Customer code already exists');

    const customer = await this.repository.create(organizationId, {
      ...dto,
      metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
    } as Prisma.CustomerCreateInput);

    await this.auditService.log({
      organizationId,
      actorId,
      action: AuditAction.CREATE,
      entityType: 'Customer',
      entityId: customer.id,
      newValues: dto as unknown as Record<string, unknown>,
    });

    return customer;
  }

  async update(organizationId: string, id: string, dto: UpdateCustomerDto, actorId: string) {
    await this.findOne(organizationId, id);
    const customer = await this.repository.update(organizationId, id, {
      ...dto,
      metadata: dto.metadata as Prisma.InputJsonValue,
    });

    await this.auditService.log({
      organizationId,
      actorId,
      action: AuditAction.UPDATE,
      entityType: 'Customer',
      entityId: id,
      newValues: dto as unknown as Record<string, unknown>,
    });

    return customer;
  }

  async remove(organizationId: string, id: string, actorId: string) {
    await this.findOne(organizationId, id);
    await this.repository.softDelete(organizationId, id);

    await this.auditService.log({
      organizationId,
      actorId,
      action: AuditAction.DELETE,
      entityType: 'Customer',
      entityId: id,
    });

    return { message: 'Customer deleted' };
  }
}
