import { Injectable } from '@nestjs/common';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { UserAuditRepository } from './user-audit.repository';

@Injectable()
export class UserAuditService {
  constructor(private readonly repository: UserAuditRepository) {}

  private async ensureUserInCompany(userId: string, companyId: string) {
    const membership = await this.repository.assertUserInCompany(userId, companyId);
    if (!membership) throw new NotFoundException('User');
  }

  async findAll(userId: string, companyId: string, query: PaginationQueryDto) {
    await this.ensureUserInCompany(userId, companyId);
    const { items, total, page, limit } = await this.repository.findManyByUser(userId, companyId, query);
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async findOne(userId: string, companyId: string, id: string) {
    await this.ensureUserInCompany(userId, companyId);
    const record = await this.repository.findById(id, userId);
    if (!record) throw new NotFoundException('User audit log');
    return serialize(record);
  }
}
