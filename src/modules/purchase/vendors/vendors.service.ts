import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { ConflictException, NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { CreateVendorDto, UpdateVendorDto } from './dto/vendor.dto';
import { VendorsRepository } from './vendors.repository';

@Injectable()
export class VendorsService {
  constructor(
    private readonly repository: VendorsRepository,
    private readonly auditService: AuditService,
  ) {}

  async findAll(companyId: string, query: PaginationQueryDto) {
    const { items, total, page, limit } = await this.repository.findManyByCompany(companyId, query);
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async findOne(id: string, companyId: string) {
    const vendor = await this.repository.findById(id, companyId);
    if (!vendor) throw new NotFoundException('Vendor');
    return serialize(vendor);
  }

  async create(companyId: string, dto: CreateVendorDto, actorId: string) {
    const code = dto.code.trim().toUpperCase();
    if (await this.repository.findByCode(companyId, code)) {
      throw new ConflictException('Vendor code already exists');
    }

    const vendor = await this.repository.create(companyId, { ...dto, code }, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'Vendor',
      entityId: vendor.vendorId.toString(),
      newValue: { vendorCode: code, name: vendor.name },
    });

    return serialize(vendor);
  }

  async update(id: string, companyId: string, dto: UpdateVendorDto, actorId: string) {
    if (!(await this.repository.findById(id, companyId))) {
      throw new NotFoundException('Vendor');
    }

    const vendor = await this.repository.update(id, dto, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'Vendor',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return serialize(vendor);
  }

  async remove(id: string, companyId: string, actorId: string) {
    if (!(await this.repository.findById(id, companyId))) {
      throw new NotFoundException('Vendor');
    }

    await this.repository.softDelete(id, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'Vendor',
      entityId: id,
    });

    return { message: 'Vendor deleted' };
  }
}
