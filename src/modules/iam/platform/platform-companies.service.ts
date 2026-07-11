import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { PlatformCompaniesRepository } from './platform-companies.repository';
import { UpdatePlatformCompanyStatusDto } from './platform-companies.dto';

@Injectable()
export class PlatformCompaniesService {
  constructor(private readonly repository: PlatformCompaniesRepository) {}

  async findAll(query: PaginationQueryDto) {
    const { items, total, page, limit } = await this.repository.findMany(query);
    const mapped = items.map((company) => this.mapCompanySummary(company));
    return serialize(toPaginatedResult(mapped, total, page, limit));
  }

  async findOne(id: string) {
    const company = await this.repository.findById(id);
    if (!company) throw new NotFoundException('Company');
    return serialize(this.mapCompanyDetail(company));
  }

  async updateStatus(id: string, dto: UpdatePlatformCompanyStatusDto, actorId: string) {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundException('Company');

    const updated = await this.repository.updateStatus(id, dto.status, actorId);
    return serialize({
      companyId: updated.companyId.toString(),
      status: updated.status,
    });
  }

  private mapCompanySummary(company: Awaited<ReturnType<PlatformCompaniesRepository['findMany']>>['items'][number]) {
    const subscription = company.subscriptions[0];
    return {
      companyId: company.companyId.toString(),
      companyCode: company.companyCode,
      name: company.name,
      status: company.status,
      email: company.email,
      createdAt: company.createdAt,
      activeUsers: company._count.userCompanies,
      subscription: subscription
        ? {
            status: subscription.status,
            planCode: subscription.plan.planCode,
            planName: subscription.plan.name,
            endDate: subscription.endDate,
          }
        : null,
    };
  }

  private mapCompanyDetail(company: NonNullable<Awaited<ReturnType<PlatformCompaniesRepository['findById']>>>) {
    const subscription = company.subscriptions[0];
    return {
      companyId: company.companyId.toString(),
      companyCode: company.companyCode,
      name: company.name,
      legalName: company.legalName,
      status: company.status,
      email: company.email,
      phone: company.phone,
      domain: company.domain,
      timezone: company.timezone,
      createdAt: company.createdAt,
      activeUsers: company._count.userCompanies,
      subscription: subscription
        ? {
            status: subscription.status,
            planCode: subscription.plan.planCode,
            planName: subscription.plan.name,
            startDate: subscription.startDate,
            endDate: subscription.endDate,
            billingCycle: subscription.billingCycle,
          }
        : null,
      securityPolicy: company.securityPolicy
        ? {
            maxLoginAttempts: company.securityPolicy.maxLoginAttempts,
            lockoutDurationMin: company.securityPolicy.lockoutDurationMin,
            sessionTimeoutMin: company.securityPolicy.sessionTimeoutMin,
            allowMultipleLogins: company.securityPolicy.allowMultipleLogins,
            maxConcurrentSessions: company.securityPolicy.maxConcurrentSessions,
          }
        : null,
    };
  }
}
