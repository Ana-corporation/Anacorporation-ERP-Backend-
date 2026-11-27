import { Injectable } from '@nestjs/common';
import { InventoryDocumentStatus, InventoryDocumentType, Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { getPaginationParams } from '@/common/dto/pagination.dto';
import { InventoryDocumentListQueryDto } from './dto/inventory-document.dto';

export const INVENTORY_DOCUMENT_PREFIX: Record<InventoryDocumentType, string> = {
  OPENING_STOCK: 'OS',
  MATERIAL_ISSUE: 'MI',
  STOCK_ADJUSTMENT: 'SA',
  STOCK_TRANSFER: 'ST',
};
const DOCUMENT_NUMBER_WIDTH = 6;

export const documentDetailInclude = {
  department: { select: { departmentId: true, departmentCode: true, name: true } },
  defaultWarehouse: { select: { warehouseId: true, warehouseCode: true, name: true } },
  defaultStore: { select: { storeCategoryId: true, name: true, storeType: true } },
  lines: {
    orderBy: { lineNo: 'asc' },
    include: {
      item: {
        select: {
          itemId: true,
          itemCode: true,
          description: true,
          manageBy: true,
          inventoryJson: true,
          inventoryUom: { select: { code: true, decimalPlaces: true } },
          itemGroupRef: { select: { itemGroupId: true, name: true, categoryCode: true } },
        },
      },
      branch: { select: { branchId: true, branchCode: true, name: true } },
      warehouse: {
        select: {
          warehouseId: true,
          warehouseCode: true,
          name: true,
          vendor: { select: { vendorId: true, vendorCode: true, name: true } },
          storeCategory: { select: { storeCategoryId: true, name: true, storeType: true } },
        },
      },
      storageBin: { select: { storageBinId: true, binCode: true, binName: true } },
      toStorageBin: { select: { storageBinId: true, binCode: true, binName: true } },
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
      ...(query.itemId || query.inventoryLocationId
        ? {
            lines: {
              some: {
                ...(query.itemId ? { itemId: BigInt(query.itemId) } : {}),
                ...(query.inventoryLocationId ? { warehouseId: BigInt(query.inventoryLocationId) } : {}),
              },
            },
          }
        : {}),
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
          defaultWarehouse: { select: { warehouseId: true, warehouseCode: true, name: true } },
          defaultStore: { select: { storeCategoryId: true, name: true, storeType: true } },
          _count: { select: { lines: true } },
        },
      }),
      this.prisma.inventoryDocument.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  /** Distinct stores (warehouses) used on each document's lines, for the list "Store" column. */
  async storesByDocument(documentIds: bigint[]) {
    const result = new Map<string, Array<{ inventoryLocationId: bigint; code: string; name: string }>>();
    if (documentIds.length === 0) return result;
    const pairs = await this.prisma.inventoryDocumentLine.groupBy({
      by: ['documentId', 'warehouseId'],
      where: { documentId: { in: documentIds } },
    });
    const warehouses = await this.prisma.warehouse.findMany({
      where: { warehouseId: { in: [...new Set(pairs.map((p) => p.warehouseId))] } },
      select: { warehouseId: true, warehouseCode: true, name: true },
    });
    const byId = new Map(warehouses.map((w) => [w.warehouseId.toString(), w]));
    for (const pair of pairs) {
      const w = byId.get(pair.warehouseId.toString());
      const key = pair.documentId.toString();
      const list = result.get(key) ?? [];
      list.push({ inventoryLocationId: pair.warehouseId, code: w?.warehouseCode ?? '', name: w?.name ?? '' });
      result.set(key, list);
    }
    for (const list of result.values()) list.sort((a, b) => a.code.localeCompare(b.code));
    return result;
  }
}
