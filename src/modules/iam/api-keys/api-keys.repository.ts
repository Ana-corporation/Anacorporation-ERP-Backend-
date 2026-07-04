import { Injectable } from '@nestjs/common';
import { ApiKeyStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { CreateApiKeyDto } from './dto/api-key.dto';

const API_KEYS_LIST_FILTER: ListFilterOptions = {
  contains: { name: 'name' },
  exact: { status: 'status' },
  dateRange: { field: 'createdDate' },
  searchFields: ['name', 'apiKey'],
  sortFields: ['createdDate', 'name', 'status', 'lastUsed', 'expiryDate'],
  defaultSortField: 'createdDate',
};

@Injectable()
export class ApiKeysRepository {
  constructor(private readonly prisma: PrismaService) {}

  async assertUserInCompany(userId: string, companyId: string) {
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
      API_KEYS_LIST_FILTER,
    ) as Prisma.UserApiKeyWhereInput;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.userApiKey.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, API_KEYS_LIST_FILTER),
        select: this.publicSelect(),
      }),
      this.prisma.userApiKey.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  findById(id: string, userId: string, companyId: string) {
    return this.prisma.userApiKey.findFirst({
      where: {
        apiKeyId: parseBigIntId(id),
        userId: parseBigIntId(userId),
        companyId: parseBigIntId(companyId),
      },
      select: this.publicSelect(),
    });
  }

  create(data: {
    userId: string;
    companyId: string;
    name?: string;
    apiKey: string;
    secretHash: string;
    scope?: string;
    expiryDate?: Date;
  }) {
    return this.prisma.userApiKey.create({
      data: {
        userId: parseBigIntId(data.userId),
        companyId: parseBigIntId(data.companyId),
        name: data.name,
        apiKey: data.apiKey,
        secretHash: data.secretHash,
        scope: data.scope,
        expiryDate: data.expiryDate,
        status: ApiKeyStatus.active,
      },
      select: this.publicSelect(),
    });
  }

  update(
    id: string,
    data: {
      name?: string;
      scope?: string;
      status?: ApiKeyStatus;
      expiryDate?: Date | null;
    },
  ) {
    return this.prisma.userApiKey.update({
      where: { apiKeyId: parseBigIntId(id) },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.scope !== undefined ? { scope: data.scope } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.expiryDate !== undefined ? { expiryDate: data.expiryDate } : {}),
      },
      select: this.publicSelect(),
    });
  }

  revoke(id: string) {
    return this.prisma.userApiKey.update({
      where: { apiKeyId: parseBigIntId(id) },
      data: { status: ApiKeyStatus.revoked },
      select: this.publicSelect(),
    });
  }

  private publicSelect() {
    return {
      apiKeyId: true,
      userId: true,
      companyId: true,
      name: true,
      apiKey: true,
      scope: true,
      createdDate: true,
      expiryDate: true,
      lastUsed: true,
      status: true,
    } satisfies Prisma.UserApiKeySelect;
  }
}
