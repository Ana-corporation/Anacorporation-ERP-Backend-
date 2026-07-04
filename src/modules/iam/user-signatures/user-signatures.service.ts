import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { BusinessException, NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { CreateUserSignatureDto, UpdateUserSignatureDto } from './dto/user-signature.dto';
import { UserSignaturesRepository } from './user-signatures.repository';

@Injectable()
export class UserSignaturesService {
  constructor(
    private readonly repository: UserSignaturesRepository,
    private readonly auditService: AuditService,
  ) {}

  private async ensureUserInCompany(userId: string, companyId: string) {
    const membership = await this.repository.assertUserInCompany(userId, companyId);
    if (!membership) throw new NotFoundException('User');
  }

  private validateDateRange(validFrom?: Date | null, validTo?: Date | null) {
    if (validFrom && validTo && validTo < validFrom) {
      throw new BusinessException('validTo must be on or after validFrom');
    }
  }

  async findAll(userId: string, companyId: string, query: PaginationQueryDto) {
    await this.ensureUserInCompany(userId, companyId);
    const { items, total, page, limit } = await this.repository.findManyByUser(userId, companyId, query);
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async findOne(userId: string, companyId: string, id: string) {
    await this.ensureUserInCompany(userId, companyId);
    const record = await this.repository.findById(id, userId);
    if (!record) throw new NotFoundException('User signature');
    return serialize(record);
  }

  async create(userId: string, companyId: string, dto: CreateUserSignatureDto, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);

    const validFrom = dto.validFrom ? new Date(dto.validFrom) : undefined;
    const validTo = dto.validTo ? new Date(dto.validTo) : undefined;
    this.validateDateRange(validFrom, validTo);

    const record = await this.repository.create({
      userId,
      companyId: dto.companyId ?? companyId,
      signatureType: dto.signatureType,
      imagePath: dto.imagePath,
      certificateData: dto.certificateData,
      isDefault: dto.isDefault ?? false,
      validFrom,
      validTo,
    });

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'UserSignature',
      entityId: record.signatureId.toString(),
      newValue: { signatureType: record.signatureType, isDefault: record.isDefault },
    });

    return serialize(record);
  }

  async update(userId: string, companyId: string, id: string, dto: UpdateUserSignatureDto, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);
    const existing = await this.repository.findById(id, userId);
    if (!existing) throw new NotFoundException('User signature');

    const validFrom =
      dto.validFrom !== undefined
        ? dto.validFrom === null
          ? null
          : new Date(dto.validFrom)
        : existing.validFrom;
    const validTo =
      dto.validTo !== undefined ? (dto.validTo === null ? null : new Date(dto.validTo)) : existing.validTo;
    this.validateDateRange(validFrom, validTo);

    const record = await this.repository.update(id, {
      ...(dto.imagePath !== undefined ? { imagePath: dto.imagePath } : {}),
      ...(dto.certificateData !== undefined ? { certificateData: dto.certificateData } : {}),
      ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
      ...(dto.validFrom !== undefined ? { validFrom } : {}),
      ...(dto.validTo !== undefined ? { validTo } : {}),
    });

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'UserSignature',
      entityId: id,
      newValue: { isDefault: dto.isDefault },
    });

    return serialize(record);
  }

  async remove(userId: string, companyId: string, id: string, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);
    const existing = await this.repository.findById(id, userId);
    if (!existing) throw new NotFoundException('User signature');

    await this.repository.delete(id);

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'UserSignature',
      entityId: id,
    });

    return { message: 'User signature deleted' };
  }
}
