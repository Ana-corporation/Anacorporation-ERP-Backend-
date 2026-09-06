import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { RedisService } from '@/infrastructure/redis/redis.service';
import { AUTH_REDIS_KEYS } from '@/modules/iam/authentication/auth-session.types';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import {
  BusinessException,
  NotFoundException,
} from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { CreateModuleOverrideDto, UpdateModuleOverrideDto, UpsertModuleAccessDto } from './dto/entitlement.dto';
import { EntitlementRepository } from './entitlement.repository';
import { EntitlementService } from './entitlement.service';

@Injectable()
export class CompanyModuleOverridesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly entitlementService: EntitlementService,
    private readonly entitlementRepository: EntitlementRepository,
    private readonly redisService: RedisService,
  ) {}

  async findAll(companyId: string, query: PaginationQueryDto) {
    const cid = parseBigIntId(companyId);
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where = { companyId: cid, deletedAt: null };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.companyModuleOverride.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { module: true },
      }),
      this.prisma.companyModuleOverride.count({ where }),
    ]);

    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async create(companyId: string, dto: CreateModuleOverrideDto, actorId: string) {
    const mod = await this.prisma.module.findFirst({
      where: {
        moduleId: parseBigIntId(dto.moduleId),
        deletedAt: null,
        moduleType: 'product',
      },
    });
    if (!mod) throw new NotFoundException('Module');
    if (mod.lifecycleStatus !== 'AVAILABLE' && mod.lifecycleStatus !== 'DEPRECATED') {
      throw new BusinessException(
        'Only AVAILABLE or DEPRECATED product modules can be overridden',
      );
    }

    const row = await this.prisma.companyModuleOverride.create({
      data: {
        companyId: parseBigIntId(companyId),
        moduleId: parseBigIntId(dto.moduleId),
        action: dto.action,
        reason: dto.reason ?? null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        createdBy: parseBigIntId(actorId),
      },
      include: { module: true },
    });

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'CompanyModuleOverride',
      entityId: row.companyModuleOverrideId.toString(),
      newValue: {
        action: dto.action,
        moduleCode: mod.moduleCode,
        reason: dto.reason ?? null,
      },
    });

    await this.invalidateCompanyCache(companyId);
    return serialize(row);
  }

  async update(
    companyId: string,
    overrideId: string,
    dto: UpdateModuleOverrideDto,
    actorId: string,
  ) {
    const existing = await this.prisma.companyModuleOverride.findFirst({
      where: {
        companyModuleOverrideId: parseBigIntId(overrideId),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
    });
    if (!existing) throw new NotFoundException('Module override');

    const row = await this.prisma.companyModuleOverride.update({
      where: { companyModuleOverrideId: existing.companyModuleOverrideId },
      data: {
        ...(dto.reason !== undefined ? { reason: dto.reason } : {}),
        ...(dto.expiresAt !== undefined
          ? { expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null }
          : {}),
        updatedBy: parseBigIntId(actorId),
        updatedAt: new Date(),
      },
      include: { module: true },
    });

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'CompanyModuleOverride',
      entityId: overrideId,
      newValue: dto as Record<string, unknown>,
    });

    await this.invalidateCompanyCache(companyId);
    return serialize(row);
  }

  async remove(companyId: string, overrideId: string, actorId: string) {
    const existing = await this.prisma.companyModuleOverride.findFirst({
      where: {
        companyModuleOverrideId: parseBigIntId(overrideId),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
      include: { module: true },
    });
    if (!existing) throw new NotFoundException('Module override');

    await this.prisma.companyModuleOverride.update({
      where: { companyModuleOverrideId: existing.companyModuleOverrideId },
      data: {
        deletedAt: new Date(),
        deletedBy: parseBigIntId(actorId),
      },
    });

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'CompanyModuleOverride',
      entityId: overrideId,
      newValue: { moduleCode: existing.module.moduleCode, action: existing.action },
    });

    await this.invalidateCompanyCache(companyId);
    return { message: 'Module override removed' };
  }

  async upsertByModuleCode(
    companyId: string,
    moduleCode: string,
    dto: UpsertModuleAccessDto,
    actorId: string,
  ) {
    const mod = await this.prisma.module.findFirst({
      where: {
        moduleCode,
        deletedAt: null,
        moduleType: 'product',
      },
    });
    if (!mod) throw new NotFoundException('Module');
    if (mod.lifecycleStatus !== 'AVAILABLE' && mod.lifecycleStatus !== 'DEPRECATED') {
      throw new BusinessException(
        'Only AVAILABLE or DEPRECATED product modules can be overridden',
      );
    }

    const cid = parseBigIntId(companyId);
    const existing = await this.prisma.companyModuleOverride.findFirst({
      where: { companyId: cid, moduleId: mod.moduleId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    const row = existing
      ? await this.prisma.companyModuleOverride.update({
          where: { companyModuleOverrideId: existing.companyModuleOverrideId },
          data: {
            action: dto.overrideType,
            reason: dto.reason ?? existing.reason,
            expiresAt:
              dto.effectiveUntil !== undefined
                ? dto.effectiveUntil
                  ? new Date(dto.effectiveUntil)
                  : null
                : existing.expiresAt,
            updatedBy: parseBigIntId(actorId),
            updatedAt: new Date(),
          },
          include: { module: true },
        })
      : await this.create(
          companyId,
          {
            moduleId: mod.moduleId.toString(),
            action: dto.overrideType,
            reason: dto.reason,
            expiresAt: dto.effectiveUntil ?? null,
          },
          actorId,
        );

    if (existing) {
      await this.auditService.log({
        companyId,
        performedBy: actorId,
        action: UserAuditAction.update,
        entityName: 'CompanyModuleOverride',
        entityId: existing.companyModuleOverrideId.toString(),
        newValue: { moduleCode, ...dto },
      });
      await this.invalidateCompanyCache(companyId);
    }

    return typeof row === 'object' && 'module' in row ? serialize(row) : row;
  }

  private async invalidateCompanyCache(companyId: string) {
    const members = await this.entitlementRepository.findCompanyUserIds(companyId);
    await Promise.all(
      members.map((m) =>
        this.redisService.del(
          AUTH_REDIS_KEYS.userContext(m.userId.toString(), companyId),
        ),
      ),
    );
  }
}
