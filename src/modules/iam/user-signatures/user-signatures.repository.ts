import { Injectable } from '@nestjs/common';
import { Prisma, SignatureType } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';

const USER_SIGNATURES_LIST_FILTER: ListFilterOptions = {
  exact: { signatureType: 'signatureType' },
  booleans: { isDefault: 'isDefault' },
  dateRange: { field: 'createdAt' },
  searchFields: ['imagePath'],
  sortFields: ['createdAt', 'signatureType', 'isDefault'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class UserSignaturesRepository {
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
      {
        userId: parseBigIntId(userId),
        OR: [{ companyId: parseBigIntId(companyId) }, { companyId: null }],
      },
      query,
      USER_SIGNATURES_LIST_FILTER,
    ) as Prisma.UserSignatureWhereInput;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.userSignature.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, USER_SIGNATURES_LIST_FILTER),
        select: this.publicSelect(),
      }),
      this.prisma.userSignature.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  findById(id: string, userId: string) {
    return this.prisma.userSignature.findFirst({
      where: {
        signatureId: parseBigIntId(id),
        userId: parseBigIntId(userId),
      },
      select: this.publicSelect(),
    });
  }

  create(data: {
    userId: string;
    companyId?: string | null;
    signatureType: SignatureType;
    imagePath?: string;
    certificateData?: string;
    isDefault: boolean;
    validFrom?: Date | null;
    validTo?: Date | null;
  }) {
    return this.prisma.userSignature.create({
      data: {
        userId: parseBigIntId(data.userId),
        companyId: data.companyId ? parseBigIntId(data.companyId) : null,
        signatureType: data.signatureType,
        imagePath: data.imagePath,
        certificateData: data.certificateData,
        isDefault: data.isDefault,
        validFrom: data.validFrom,
        validTo: data.validTo,
      },
      select: this.publicSelect(),
    });
  }

  update(
    id: string,
    data: {
      imagePath?: string | null;
      certificateData?: string | null;
      isDefault?: boolean;
      validFrom?: Date | null;
      validTo?: Date | null;
    },
  ) {
    return this.prisma.userSignature.update({
      where: { signatureId: parseBigIntId(id) },
      data: {
        ...(data.imagePath !== undefined ? { imagePath: data.imagePath } : {}),
        ...(data.certificateData !== undefined ? { certificateData: data.certificateData } : {}),
        ...(data.isDefault !== undefined ? { isDefault: data.isDefault } : {}),
        ...(data.validFrom !== undefined ? { validFrom: data.validFrom } : {}),
        ...(data.validTo !== undefined ? { validTo: data.validTo } : {}),
        updatedAt: new Date(),
      },
      select: this.publicSelect(),
    });
  }

  delete(id: string) {
    return this.prisma.userSignature.delete({
      where: { signatureId: parseBigIntId(id) },
      select: this.publicSelect(),
    });
  }

  private publicSelect() {
    return {
      signatureId: true,
      userId: true,
      companyId: true,
      signatureType: true,
      imagePath: true,
      certificateData: true,
      isDefault: true,
      validFrom: true,
      validTo: true,
      createdAt: true,
      updatedAt: true,
    } satisfies Prisma.UserSignatureSelect;
  }
}
