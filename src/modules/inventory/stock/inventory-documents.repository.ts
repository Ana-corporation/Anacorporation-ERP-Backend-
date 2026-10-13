import { Injectable } from '@nestjs/common';
import { InventoryDocumentStatus, InventoryDocumentType, Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { getPaginationParams } from '@/common/dto/pagination.dto';
import { InventoryDocumentListQueryDto } from './dto/inventory-document.dto';

export const INVENTORY_DOCUMENT_PREFIX: Record<InventoryDocumentType, string> = {
  OPENING_STOCK: 'OS',
  MATERIAL_ISSUE: 'MI',
  STOCK_ADJUSTMENT: 'SA',
};
const DOCUMENT_NUMBER_WIDTH = 6;

export const documentDetailInclude = {
  department: { select: { departmentId: true, departmentCode: true, name: true } },
  lines: {
    orderBy: { lineNo: 'asc' },
    include: {
      item: { select: { itemId: true, itemCode: true, description: true } },
      branch: { select: { branchId: true, branchCode: true, name: true } },
      warehouse: { select: { warehouseId: true, warehouseCode: true, name: true } },
      storageBin: { select: { storageBinId: true, binCode: true, binName: true } },
    },
  },
} satisfies Prisma.InventoryDocumentInclude;

export type InventoryDocumentDetail = Prisma.InventoryDocumentGetPayload<{
  include: typeof documentDetailInclude;
}>;

const SORT_FIELDS = new Set(['documentNumber', 'documentDate', 'status', 'createdAt', 'postedAt']);

@Injectable()
export class InventoryDocumentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Serialised per company + type with an advisory lock; numbers of deleted drafts are never reused. */
  async nextDocumentNumber(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    documentType: InventoryDocumentType,
  ): Promise<string> {
    const prefix = INVENTORY_DOCUMENT_PREFIX[documentType];
    const lockKey = `inventory_document:${companyId}:${documentType}`;
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${lockKey}))) AS l`;
    const last = await tx.inventoryDocument.findFirst({
      where: { companyId, documentType, documentNumber: { startsWith: `${prefix}-` } },
      orderBy: { documentNumber: 'desc' },
      select: { documentNumber: true },
    });
    const lastSeq = last ? Number(last.documentNumber.slice(prefix.length + 1)) || 0 : 0;
    return `${prefix}-${String(lastSeq + 1).padStart(DOCUMENT_NUMBER_WIDTH, '0')}`;
  }

  findDetail(
    db: Prisma.TransactionClient | PrismaService,
    companyId: bigint,
    documentType: InventoryDocumentType,
    documentId: bigint,
  ) {
    return (db as Prisma.TransactionClient).inventoryDocument.findFirst({
      where: { documentId, companyId, documentType, deletedAt: null },
      include: documentDetailInclude,
    });
  }

  async list(companyId: bigint, documentType: InventoryDocumentType, query: InventoryDocumentListQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const status = query.status?.toUpperCase();
    const search = query.search?.trim() || query.documentNumber;
    const where: Prisma.InventoryDocumentWhereInput = {
      companyId,
      documentType,
      deletedAt: null,
      ...(status === 'DRAFT' || status === 'POSTED' ? { status: status as InventoryDocumentStatus } : {}),
      ...(query.fromDate || query.toDate
        ? {
            documentDate: {
              ...(query.fromDate ? { gte: new Date(query.fromDate) } : {}),
              ...(query.toDate ? { lte: new Date(query.toDate) } : {}),
            },
          }
        : {}),
      ...(search ? { documentNumber: { contains: search, mode: 'insensitive' } } : {}),
      ...(query.itemId ? { lines: { some: { itemId: BigInt(query.itemId) } } } : {}),
    };
    const sortBy = SORT_FIELDS.has(query.sortBy) ? query.sortBy : 'createdAt';

    const [items, total] = await this.prisma.$transaction([
      this.prisma.inventoryDocument.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ [sortBy]: query.sortOrder ?? 'desc' }, { documentId: 'desc' }],
        include: {
          department: { select: { departmentId: true, departmentCode: true, name: true } },
          _count: { select: { lines: true } },
        },
      }),
      this.prisma.inventoryDocument.count({ where }),
    ]);
    return { items, total, page, limit };
  }
}
