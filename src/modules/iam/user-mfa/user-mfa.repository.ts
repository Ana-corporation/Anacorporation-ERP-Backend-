import { Injectable } from '@nestjs/common';
import { MfaType, Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';

const USER_MFA_LIST_FILTER: ListFilterOptions = {
  exact: { mfaType: 'mfaType' },
  contains: { email: 'email' },
  booleans: { isPrimary: 'isPrimary', isEnabled: 'isEnabled' },
  dateRange: { field: 'createdAt' },
  searchFields: ['email', 'phone'],
  sortFields: ['createdAt', 'mfaType', 'isPrimary', 'verifiedAt'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class UserMfaRepository {
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

  async findManyByUser(userId: string, query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = buildListWhere(
      { userId: parseBigIntId(userId) },
      query,
      USER_MFA_LIST_FILTER,
    ) as Prisma.UserMfaWhereInput;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.userMfa.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, USER_MFA_LIST_FILTER),
        select: this.publicSelect(),
      }),
      this.prisma.userMfa.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  findById(id: string, userId: string) {
    return this.prisma.userMfa.findFirst({
      where: {
        userMfaId: parseBigIntId(id),
        userId: parseBigIntId(userId),
      },
      select: this.publicSelect(),
    });
  }

  create(data: {
    userId: string;
    mfaType: MfaType;
    secret?: string;
    phone?: string;
    email?: string;
    isPrimary: boolean;
    isEnabled: boolean;
    verifiedAt?: Date | null;
    recoveryCodes?: string;
  }) {
    return this.prisma.userMfa.create({
      data: {
        userId: parseBigIntId(data.userId),
        mfaType: data.mfaType,
        secret: data.secret,
        phone: data.phone,
        email: data.email,
        isPrimary: data.isPrimary,
        isEnabled: data.isEnabled,
        verifiedAt: data.verifiedAt,
        recoveryCodes: data.recoveryCodes,
      },
      select: this.publicSelect(),
    });
  }

  update(
    id: string,
    data: {
      secret?: string | null;
      phone?: string | null;
      email?: string | null;
      isPrimary?: boolean;
      isEnabled?: boolean;
      verifiedAt?: Date | null;
      recoveryCodes?: string | null;
    },
  ) {
    return this.prisma.userMfa.update({
      where: { userMfaId: parseBigIntId(id) },
      data: {
        ...(data.secret !== undefined ? { secret: data.secret } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.isPrimary !== undefined ? { isPrimary: data.isPrimary } : {}),
        ...(data.isEnabled !== undefined ? { isEnabled: data.isEnabled } : {}),
        ...(data.verifiedAt !== undefined ? { verifiedAt: data.verifiedAt } : {}),
        ...(data.recoveryCodes !== undefined ? { recoveryCodes: data.recoveryCodes } : {}),
        updatedAt: new Date(),
      },
      select: this.publicSelect(),
    });
  }

  delete(id: string) {
    return this.prisma.userMfa.delete({
      where: { userMfaId: parseBigIntId(id) },
      select: this.publicSelect(),
    });
  }

  private publicSelect() {
    return {
      userMfaId: true,
      userId: true,
      mfaType: true,
      secret: true,
      phone: true,
      email: true,
      isPrimary: true,
      isEnabled: true,
      verifiedAt: true,
      recoveryCodes: true,
      createdAt: true,
      updatedAt: true,
    } satisfies Prisma.UserMfaSelect;
  }
}
