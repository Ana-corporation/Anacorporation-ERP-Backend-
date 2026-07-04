import { Injectable } from '@nestjs/common';
import { DocumentType, Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';

const USER_ATTACHMENTS_LIST_FILTER: ListFilterOptions = {
  exact: { documentType: 'documentType' },
  booleans: { isVerified: 'isVerified' },
  dateRange: { field: 'uploadedDate' },
  searchFields: ['fileName', 'filePath'],
  sortFields: ['uploadedDate', 'fileName', 'documentType', 'expiryDate'],
  defaultSortField: 'uploadedDate',
};

@Injectable()
export class UserAttachmentsRepository {
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
      USER_ATTACHMENTS_LIST_FILTER,
    ) as Prisma.UserAttachmentWhereInput;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.userAttachment.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, USER_ATTACHMENTS_LIST_FILTER),
        select: this.publicSelect(),
      }),
      this.prisma.userAttachment.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  findById(id: string, userId: string, companyId: string) {
    return this.prisma.userAttachment.findFirst({
      where: {
        attachmentId: parseBigIntId(id),
        userId: parseBigIntId(userId),
        companyId: parseBigIntId(companyId),
      },
      select: this.publicSelect(),
    });
  }

  create(data: {
    userId: string;
    companyId: string;
    documentType: DocumentType;
    fileName?: string;
    filePath: string;
    fileSize?: bigint;
    mimeType?: string;
    expiryDate?: Date;
    uploadedBy: string;
  }) {
    return this.prisma.userAttachment.create({
      data: {
        userId: parseBigIntId(data.userId),
        companyId: parseBigIntId(data.companyId),
        documentType: data.documentType,
        fileName: data.fileName,
        filePath: data.filePath,
        fileSize: data.fileSize,
        mimeType: data.mimeType,
        expiryDate: data.expiryDate,
        uploadedBy: parseBigIntId(data.uploadedBy),
      },
      select: this.publicSelect(),
    });
  }

  update(
    id: string,
    data: {
      documentType?: DocumentType;
      fileName?: string | null;
      filePath?: string;
      fileSize?: bigint | null;
      mimeType?: string | null;
      expiryDate?: Date | null;
      isVerified?: boolean;
    },
  ) {
    return this.prisma.userAttachment.update({
      where: { attachmentId: parseBigIntId(id) },
      data: {
        ...(data.documentType !== undefined ? { documentType: data.documentType } : {}),
        ...(data.fileName !== undefined ? { fileName: data.fileName } : {}),
        ...(data.filePath !== undefined ? { filePath: data.filePath } : {}),
        ...(data.fileSize !== undefined ? { fileSize: data.fileSize } : {}),
        ...(data.mimeType !== undefined ? { mimeType: data.mimeType } : {}),
        ...(data.expiryDate !== undefined ? { expiryDate: data.expiryDate } : {}),
        ...(data.isVerified !== undefined ? { isVerified: data.isVerified } : {}),
      },
      select: this.publicSelect(),
    });
  }

  delete(id: string) {
    return this.prisma.userAttachment.delete({
      where: { attachmentId: parseBigIntId(id) },
      select: this.publicSelect(),
    });
  }

  private publicSelect() {
    return {
      attachmentId: true,
      userId: true,
      companyId: true,
      documentType: true,
      fileName: true,
      filePath: true,
      fileSize: true,
      mimeType: true,
      expiryDate: true,
      isVerified: true,
      uploadedBy: true,
      uploadedDate: true,
    } satisfies Prisma.UserAttachmentSelect;
  }
}
