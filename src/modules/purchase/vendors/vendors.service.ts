import { Injectable } from '@nestjs/common';
import { Prisma, UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { ConflictException, NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { CustomFieldsValuesService } from '@/modules/shared/custom-fields/custom-fields.service';
import { CreateVendorDto, UpdateVendorDto } from './dto/vendor.dto';
import { extractCfFilters, VendorListQueryDto } from './dto/vendor-list-query.dto';
import { SUPPLIER_TYPE_PREFIX } from './vendor-code.util';
import { VendorsRepository } from './vendors.repository';

@Injectable()
export class VendorsService {
  constructor(
    private readonly repository: VendorsRepository,
    private readonly auditService: AuditService,
    private readonly prisma: PrismaService,
    private readonly customFieldsValuesService: CustomFieldsValuesService,
  ) {}

  async findAll(companyId: string, query: VendorListQueryDto & Record<string, unknown>) {
    const cfFilters = extractCfFilters(query);
    const recordIdFilter = await this.customFieldsValuesService.filterRecordIdsByCustomFields(
      companyId,
      'vendor',
      cfFilters,
    );

    const { items, total, page, limit } = await this.repository.findManyByCompany(
      companyId,
      query,
      recordIdFilter,
    );

    if (!query.includeCustomFields) {
      return serialize(toPaginatedResult(items, total, page, limit));
    }

    const maps = await this.customFieldsValuesService.loadCustomFieldsMapsForRecords(
      companyId,
      'vendor',
      items.map((v) => v.vendorId),
    );

    const withCf = items.map((item) => ({
      ...serialize(item),
      customFields: maps.get(item.vendorId.toString()) ?? {},
    }));

    return toPaginatedResult(withCf, total, page, limit);
  }

  async findOne(id: string, companyId: string) {
    const vendor = await this.repository.findById(id, companyId);
    if (!vendor) throw new NotFoundException('Vendor');

    const withCustomFields = await this.customFieldsValuesService.mergeEntityWithCustomFields(
      companyId,
      'vendor',
      vendor.vendorId.toString(),
      serialize(vendor) as Record<string, unknown>,
    );

    return withCustomFields;
  }

  async create(companyId: string, dto: CreateVendorDto, actorId: string) {
    const prefix = SUPPLIER_TYPE_PREFIX[dto.supplierType];
    const { customFields, ...vendorDto } = dto;

    const vendor = await this.prisma.$transaction(async (tx) => {
      const client = tx as unknown as Prisma.TransactionClient;
      const vendorCode = await this.repository.nextVendorCode(companyId, prefix, client);

      if (await this.repository.findByCode(companyId, vendorCode, client)) {
        throw new ConflictException('Vendor code already exists');
      }

      const created = await this.repository.create(
        companyId,
        vendorDto,
        vendorCode,
        actorId,
        client,
      );
      await this.customFieldsValuesService.persistCustomFields(
        companyId,
        'vendor',
        created.vendorId.toString(),
        customFields,
        'create',
        client,
      );
      return created;
    });

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'Vendor',
      entityId: vendor.vendorId.toString(),
      newValue: {
        vendorCode: vendor.vendorCode,
        supplierType: vendor.supplierType,
        name: vendor.name,
      },
    });

    return this.findOne(vendor.vendorId.toString(), companyId);
  }

  async update(id: string, companyId: string, dto: UpdateVendorDto, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) {
      throw new NotFoundException('Vendor');
    }

    const { customFields, ...vendorDto } = dto;

    // Deep-merge metadata so hidden built-in fields retain values when FE omits them.
    if (vendorDto.metadata !== undefined) {
      const prior =
        existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
          ? (existing.metadata as Record<string, unknown>)
          : {};
      vendorDto.metadata = { ...prior, ...vendorDto.metadata };
    }

    await this.prisma.$transaction(async (tx) => {
      const client = tx as unknown as Prisma.TransactionClient;
      if (Object.keys(vendorDto).length > 0) {
        await this.repository.update(id, vendorDto, actorId, client);
      }
      if (customFields !== undefined) {
        await this.customFieldsValuesService.persistCustomFields(
          companyId,
          'vendor',
          id,
          customFields,
          'update',
          client,
        );
      }
    });

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'Vendor',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return this.findOne(id, companyId);
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
