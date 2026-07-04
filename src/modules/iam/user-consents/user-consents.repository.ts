import { Injectable } from '@nestjs/common';
import { ConsentType, Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';

const USER_CONSENTS_LIST_FILTER: ListFilterOptions = {
  exact: { consentType: 'consentType' },
  booleans: { isAccepted: 'isAccepted' },
  dateRange: { field: 'createdAt' },
  searchFields: ['consentVersion', 'ipAddress'],
  sortFields: ['createdAt', 'consentType', 'acceptedDate'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class UserConsentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  assertUserInCompany(userId: string, companyId: string) {
    return this.prisma.userCompany.findFirst({
      where: {
        userId: parseBigIntId(userId),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        status: 'active',
      },
    });
  }

  async findManyByUser(userId: string, companyId: string, query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = buildListWhere(
      { userId: parseBigIntId(userId), companyId: parseBigIntId(companyId) },
      query,
      USER_CONSENTS_LIST_FILTER,
    ) as Prisma.UserConsentWhereInput;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.userConsent.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, USER_CONSENTS_LIST_FILTER),
        select: this.publicSelect(),
      }),
      this.prisma.userConsent.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  findById(id: string, userId: string, companyId: string) {
    return this.prisma.userConsent.findFirst({
      where: {
        consentId: parseBigIntId(id),
        userId: parseBigIntId(userId),
        companyId: parseBigIntId(companyId),
      },
      select: this.publicSelect(),
    });
  }

  create(data: {
    userId: string;
    companyId: string;
    consentType: ConsentType;
    consentVersion: string;
    isAccepted: boolean;
    acceptedDate?: Date | null;
    ipAddress?: string;
  }) {
    return this.prisma.userConsent.create({
      data: {
        userId: parseBigIntId(data.userId),
        companyId: parseBigIntId(data.companyId),
        consentType: data.consentType,
        consentVersion: data.consentVersion,
        isAccepted: data.isAccepted,
        acceptedDate: data.acceptedDate,
        ipAddress: data.ipAddress,
      },
      select: this.publicSelect(),
    });
  }

  update(
    id: string,
    data: {
      consentVersion?: string;
      isAccepted?: boolean;
      acceptedDate?: Date | null;
      ipAddress?: string | null;
    },
  ) {
    return this.prisma.userConsent.update({
      where: { consentId: parseBigIntId(id) },
      data: {
        ...(data.consentVersion !== undefined ? { consentVersion: data.consentVersion } : {}),
        ...(data.isAccepted !== undefined ? { isAccepted: data.isAccepted } : {}),
        ...(data.acceptedDate !== undefined ? { acceptedDate: data.acceptedDate } : {}),
        ...(data.ipAddress !== undefined ? { ipAddress: data.ipAddress } : {}),
      },
      select: this.publicSelect(),
    });
  }

  delete(id: string) {
    return this.prisma.userConsent.delete({
      where: { consentId: parseBigIntId(id) },
      select: this.publicSelect(),
    });
  }

  private publicSelect() {
    return {
      consentId: true,
      userId: true,
      companyId: true,
      consentType: true,
      consentVersion: true,
      isAccepted: true,
      acceptedDate: true,
      ipAddress: true,
      createdAt: true,
    } satisfies Prisma.UserConsentSelect;
  }
}
