import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parseBigIntId, serialize } from '@/common/utils/bigint.util';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { ItemLookupQueryDto } from './dto/item.dto';
import { loadProcurementTypes, PROCUREMENT_FIELD_NAME } from './item-procurement.util';

/** Light, read-only item picker (BOM parent / component, other documents). No cost or sensitive fields. */
@Injectable()
export class ItemsLookupService {
  constructor(private readonly prisma: PrismaService) {}

  async lookup(companyId: string, query: ItemLookupQueryDto) {
    const cid = parseBigIntId(companyId, 'companyId');
    const db = this.prisma as unknown as Prisma.TransactionClient;
    const search = query.search?.trim();
    const wanted = (query.procurementType ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);

    let restrictIds: bigint[] | null = null;
    if (wanted.length) {
      const field = await db.customFieldDefinition.findFirst({
        where: { companyId: cid, entityType: 'item', fieldName: PROCUREMENT_FIELD_NAME, deletedAt: null, isActive: true },
        select: { fieldId: true },
      });
      if (field) {
        const rows = await db.customFieldValue.findMany({
          where: {
            companyId: cid,
            entityType: 'item',
            fieldId: field.fieldId,
            OR: wanted.map((w) => ({ valueText: { equals: w, mode: 'insensitive' as const } })),
          },
          select: { recordId: true },
        });
        restrictIds = rows.map((r) => r.recordId);
      }
    }

    const items = await db.item.findMany({
      where: {
        companyId: cid,
        deletedAt: null,
        isActive: true,
        status: { notIn: ['inactive', 'obsolete'] },
        ...(restrictIds ? { itemId: { in: restrictIds } } : {}),
        ...(query.storeCategoryId ? { storeCategoryId: BigInt(query.storeCategoryId) } : {}),
        ...(query.itemGroupId ? { itemGroupId: BigInt(query.itemGroupId) } : {}),
        ...(query.excludeItemId ? { NOT: { itemId: BigInt(query.excludeItemId) } } : {}),
        ...(query.excludeMachines ? { machine: { is: null } } : {}),
        ...(query.onlyMachines ? { machine: { isNot: null } } : {}),
        ...(search
          ? {
              OR: [
                { itemCode: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
                { oldCode: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ itemCode: 'asc' }, { itemId: 'asc' }],
      take: query.limit,
      select: {
        itemId: true,
        itemCode: true,
        description: true,
        oldCode: true,
        status: true,
        inventoryUom: { select: { uomId: true, code: true, name: true } },
        itemGroupRef: { select: { itemGroupId: true, name: true, categoryCode: true } },
        storeCategory: { select: { storeCategoryId: true, name: true } },
      },
    });

    const procurement = await loadProcurementTypes(db, cid, items.map((i) => i.itemId));
    return serialize({
      procurementFieldConfigured: procurement.hasField,
      items: items.map((i) => ({
        itemId: i.itemId,
        itemCode: i.itemCode,
        name: i.description,
        oldCode: i.oldCode,
        status: i.status,
        uom: i.inventoryUom,
        itemGroup: i.itemGroupRef,
        storeCategory: i.storeCategory,
        procurementType: procurement.byItemId.get(i.itemId.toString()) ?? null,
      })),
    });
  }
}
