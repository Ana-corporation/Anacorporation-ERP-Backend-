import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { CreateCompanySecurityPolicyDto, UpdateCompanySecurityPolicyDto } from './dto/company-security-policy.dto';

const COMPANY_SECURITY_POLICIES_LIST_FILTER: ListFilterOptions = {
  dateRange: { field: 'createdAt' },
  sortFields: ['createdAt', 'updatedAt', 'policyId'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class CompanySecurityPoliciesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByCompany(companyId: string, query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = buildListWhere(
      { companyId: parseBigIntId(companyId) },
      query,
      COMPANY_SECURITY_POLICIES_LIST_FILTER,
    ) as Prisma.CompanySecurityPolicyWhereInput;

    return this.prisma.$transaction([
      this.prisma.companySecurityPolicy.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, COMPANY_SECURITY_POLICIES_LIST_FILTER),
      }),
      this.prisma.companySecurityPolicy.count({ where }),
    ]).then(([items, total]) => ({ items, total, page, limit }));
  }

  findById(id: string, companyId: string) {
    return this.prisma.companySecurityPolicy.findFirst({
      where: {
        policyId: parseBigIntId(id),
        companyId: parseBigIntId(companyId),
      },
    });
  }

  findByCompanyId(companyId: string) {
    return this.prisma.companySecurityPolicy.findUnique({
      where: { companyId: parseBigIntId(companyId) },
    });
  }

  create(companyId: string, dto: CreateCompanySecurityPolicyDto, createdBy?: string) {
    return this.prisma.companySecurityPolicy.create({
      data: {
        companyId: parseBigIntId(companyId),
        passwordExpiryDays: dto.passwordExpiryDays ?? 90,
        passwordNeverExpires: dto.passwordNeverExpires ?? false,
        forcePasswordRotation: dto.forcePasswordRotation ?? false,
        minPasswordLength: dto.minPasswordLength ?? 8,
        requireStrongPassword: dto.requireStrongPassword ?? true,
        requireMfa: dto.requireMfa ?? false,
        maxLoginAttempts: dto.maxLoginAttempts ?? 5,
        lockoutDurationMin: dto.lockoutDurationMin ?? 30,
        allowMultipleLogins: dto.allowMultipleLogins ?? true,
        maxConcurrentSessions: dto.maxConcurrentSessions,
        sessionTimeoutMin: dto.sessionTimeoutMin ?? 480,
        licenseType: dto.licenseType ?? 'named',
        totalLicenses: dto.totalLicenses,
        createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
      },
    });
  }

  update(id: string, dto: UpdateCompanySecurityPolicyDto, updatedBy?: string) {
    return this.prisma.companySecurityPolicy.update({
      where: { policyId: parseBigIntId(id) },
      data: {
        ...(dto.passwordExpiryDays !== undefined ? { passwordExpiryDays: dto.passwordExpiryDays } : {}),
        ...(dto.passwordNeverExpires !== undefined ? { passwordNeverExpires: dto.passwordNeverExpires } : {}),
        ...(dto.forcePasswordRotation !== undefined ? { forcePasswordRotation: dto.forcePasswordRotation } : {}),
        ...(dto.minPasswordLength !== undefined ? { minPasswordLength: dto.minPasswordLength } : {}),
        ...(dto.requireStrongPassword !== undefined ? { requireStrongPassword: dto.requireStrongPassword } : {}),
        ...(dto.requireMfa !== undefined ? { requireMfa: dto.requireMfa } : {}),
        ...(dto.maxLoginAttempts !== undefined ? { maxLoginAttempts: dto.maxLoginAttempts } : {}),
        ...(dto.lockoutDurationMin !== undefined ? { lockoutDurationMin: dto.lockoutDurationMin } : {}),
        ...(dto.allowMultipleLogins !== undefined ? { allowMultipleLogins: dto.allowMultipleLogins } : {}),
        ...(dto.maxConcurrentSessions !== undefined ? { maxConcurrentSessions: dto.maxConcurrentSessions } : {}),
        ...(dto.sessionTimeoutMin !== undefined ? { sessionTimeoutMin: dto.sessionTimeoutMin } : {}),
        ...(dto.licenseType !== undefined ? { licenseType: dto.licenseType } : {}),
        ...(dto.totalLicenses !== undefined ? { totalLicenses: dto.totalLicenses } : {}),
        updatedBy: updatedBy ? parseBigIntId(updatedBy) : undefined,
        updatedAt: new Date(),
      },
    });
  }

  delete(id: string) {
    return this.prisma.companySecurityPolicy.delete({
      where: { policyId: parseBigIntId(id) },
    });
  }
}
