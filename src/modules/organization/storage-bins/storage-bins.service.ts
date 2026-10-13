import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import {
  BusinessException,
  ConflictException,
  NotFoundException,
} from '@/common/exceptions/business.exception';
import { parseBigIntId, serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { WarehousesRepository } from '../warehouses/warehouses.repository';
import {
  BIN_BULK_LIMIT,
  BulkCreateStorageBinsDto,
  CreateStorageBinDto,
  UpdateStorageBinDto,
} from './dto/storage-bin.dto';
import { StorageBinsRepository } from './storage-bins.repository';

export const BIN_ERROR_CODES = {
  CODE_DUPLICATE: 'BIN_CODE_DUPLICATE',
  IN_USE: 'BIN_IN_USE',
  BULK_LIMIT: 'BIN_BULK_LIMIT',
} as const;

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

  private duplicateError(deleted = false) {
    return new ConflictException(
      deleted
        ? 'Bin code was used by a deleted bin in this inventory location; choose another code'
        : 'Bin code must be unique within the inventory location',
      BIN_ERROR_CODES.CODE_DUPLICATE,
    );
  }

  private async assertCodeFree(warehouseId: string, code: string, selfId?: string) {
    const clash = await this.repository.findByCode(warehouseId, code);
    if (clash && clash.storageBinId.toString() !== selfId) throw this.duplicateError(clash.deletedAt !== null);
  }

  private rethrowDuplicate(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw this.duplicateError();
    }
    throw error;
  }

  async findAll(companyId: string, query: PaginationQueryDto) {
    const { items, total, page, limit } = await this.repository.findManyByCompany(companyId, query);
    const mapped = items.map((item) => this.mapBin(serialize(item) as Record<string, unknown>));
    const withAudit = await this.auditService.withAuditList(mapped);
    return toPaginatedResult(withAudit, total, page, limit);
  }

  async findOne(id: string, companyId: string) {
    const bin = await this.repository.findById(id, companyId);
    if (!bin) throw new NotFoundException('Storage bin');
    return this.auditService.withAudit(this.mapBin(serialize(bin) as Record<string, unknown>));
  }

  /** Bins can only be added to an active location of this company that uses bins. */
  private async assertBinLocation(companyId: string, warehouseId: string) {
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
  }

  async create(companyId: string, dto: CreateStorageBinDto, actorId: string) {
    const warehouseId = this.resolveWarehouseId(dto);
    await this.assertBinLocation(companyId, warehouseId);

    const code = dto.binCode.trim().toUpperCase();
    await this.assertCodeFree(warehouseId, code);

    const bin = await this.repository
      .create(companyId, warehouseId, { ...dto, binCode: code }, actorId)
      .catch((error: unknown) => this.rethrowDuplicate(error));

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'StorageBin',
      entityId: bin.storageBinId.toString(),
      newValue: { binCode: code, warehouseId },
    });

    return this.auditService.withAudit(this.mapBin(serialize(bin) as Record<string, unknown>));
  }

  /**
   * One transaction. skipExisting=true creates the free codes and reports the rest;
   * skipExisting=false fails the whole request on any clash.
   */
  async bulkCreate(companyId: string, dto: BulkCreateStorageBinsDto, actorId: string) {
    const warehouseId = (dto.inventoryLocationId || dto.warehouseId)!;
    if (dto.bins.length > BIN_BULK_LIMIT) {
      throw new BusinessException(
        `At most ${BIN_BULK_LIMIT} bins per request`,
        HttpStatus.BAD_REQUEST,
        [{ field: 'bins', message: `Send at most ${BIN_BULK_LIMIT} bins` }],
        BIN_ERROR_CODES.BULK_LIMIT,
      );
    }
    await this.assertBinLocation(companyId, warehouseId);

    const bins = dto.bins.map((bin) => ({ ...bin, binCode: bin.binCode.trim().toUpperCase() }));
    const firstIndex = new Map<string, number>();
    const repeated = bins.flatMap((bin, i) => {
      if (!firstIndex.has(bin.binCode)) {
        firstIndex.set(bin.binCode, i);
        return [];
      }
      return [{ field: `bins.${i}.binCode`, message: `${bin.binCode} is repeated in this request` }];
    });
    if (repeated.length) {
      throw new BusinessException(
        'Bin codes must be unique within the request',
        HttpStatus.BAD_REQUEST,
        repeated,
        BIN_ERROR_CODES.CODE_DUPLICATE,
      );
    }

    const company = parseBigIntId(companyId);
    const location = parseBigIntId(warehouseId);
    const { created, skipped } = await this.repository
      .transaction(async (tx) => {
        const existing = new Map(
          (await this.repository.findCodes(tx, location, bins.map((b) => b.binCode))).map((b) => [
            b.binCode,
            b.deletedAt ? ('DELETED_CODE' as const) : ('EXISTS' as const),
          ]),
        );
        if (existing.size && !dto.skipExisting) {
          throw new BusinessException(
            'Some bin codes already exist in this inventory location',
            HttpStatus.CONFLICT,
            bins.flatMap((bin, i) =>
              existing.has(bin.binCode)
                ? [{ field: `bins.${i}.binCode`, message: `${bin.binCode}: ${existing.get(bin.binCode)}` }]
                : [],
            ),
            BIN_ERROR_CODES.CODE_DUPLICATE,
          );
        }
        const rows = await this.repository.createMany(
          tx,
          company,
          location,
          bins.filter((bin) => !existing.has(bin.binCode)),
          dto.skipExisting,
          actorId,
        );
        const createdCodes = new Set(rows.map((r) => r.binCode));
        return {
          created: rows.sort((a, b) => firstIndex.get(a.binCode)! - firstIndex.get(b.binCode)!),
          skipped: bins
            .filter((bin) => !createdCodes.has(bin.binCode))
            .map((bin) => ({ binCode: bin.binCode, reason: existing.get(bin.binCode) ?? ('EXISTS' as const) })),
        };
      })
      .catch((error: unknown) => this.rethrowDuplicate(error));

    if (created.length) {
      await this.auditService.log({
        companyId,
        performedBy: actorId,
        action: UserAuditAction.create,
        entityName: 'StorageBin',
        entityId: warehouseId,
        newValue: { bulk: true, warehouseId, binCodes: created.map((b) => b.binCode) },
      });
    }

    const rows = await this.auditService.withAuditList(
      created.map((bin) => this.mapBin(serialize(bin) as Record<string, unknown>)),
    );
    return { created: rows, skipped };
  }

  async update(id: string, companyId: string, dto: UpdateStorageBinDto, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw new NotFoundException('Storage bin');

    if (dto.binCode) {
      const code = dto.binCode.trim().toUpperCase();
      await this.assertCodeFree(existing.warehouseId.toString(), code, id);
      dto = { ...dto, binCode: code };
    }

    const bin = await this.repository
      .update(id, dto, actorId)
      .catch((error: unknown) => this.rethrowDuplicate(error));

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'StorageBin',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return this.auditService.withAudit(this.mapBin(serialize(bin) as Record<string, unknown>));
  }

  async remove(id: string, companyId: string, actorId: string) {
    if (!(await this.repository.findById(id, companyId))) throw new NotFoundException('Storage bin');
    if (await this.repository.isReferenced(id)) {
      throw new ConflictException(
        'Bin has stock or inventory documents; deactivate it instead',
        BIN_ERROR_CODES.IN_USE,
      );
    }

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
