import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { ConflictException, NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { CurrenciesRepository } from './currencies.repository';
import { CreateCurrencyDto, UpdateCurrencyDto } from './dto/currency.dto';

@Injectable()
export class CurrenciesService {
  constructor(
    private readonly repository: CurrenciesRepository,
    private readonly auditService: AuditService,
  ) {}

  async findAll(query: PaginationQueryDto) {
    const { items, total, page, limit } = await this.repository.findMany(query);
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async findOne(id: string) {
    const currency = await this.repository.findById(id);
    if (!currency) throw new NotFoundException('Currency');
    return serialize(currency);
  }

  async create(dto: CreateCurrencyDto, actorId?: string) {
    const existing = await this.repository.findByCode(dto.code);
    if (existing) throw new ConflictException('Currency code already exists');

    const currency = await this.repository.create(dto);

    await this.auditService.log({
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'Currency',
      entityId: currency.currencyId.toString(),
      newValue: { code: currency.code, name: currency.name },
    });

    return serialize(currency);
  }

  async update(id: string, dto: UpdateCurrencyDto, actorId?: string) {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundException('Currency');

    const currency = await this.repository.update(id, dto);

    await this.auditService.log({
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'Currency',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return serialize(currency);
  }

  async remove(id: string, actorId?: string) {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundException('Currency');

    await this.repository.softDelete(id);

    await this.auditService.log({
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'Currency',
      entityId: id,
    });

    return { message: 'Currency deleted' };
  }
}
