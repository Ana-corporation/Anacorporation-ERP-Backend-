import { Injectable } from '@nestjs/common';
import { BomStatus, Prisma, UserAuditAction } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { bomNotFound, rowVersionConflict } from './bom.constants';
import { ValidationItem } from './bom-validation';

export type Db = Prisma.TransactionClient;

export interface BomItem extends ValidationItem {
  description: string;
  uomCode: string | null;
}

/** Data access shared by the header and line services. Every query is scoped by companyId. */
@Injectable()
export class BomsRepository {
  constructor(readonly prisma: PrismaService) {}

  get db(): Db {
    return this.prisma as unknown as Db;
  }

  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => fn(tx as unknown as Db), { timeout: 60_000, maxWait: 15_000 });
  }

  /** Row-locks the BOM header (serialises Common Key allocation, line numbers and status changes). */
  async lockBom(tx: Db, companyId: bigint, bomId: bigint) {
    const locked = await tx.$queryRaw<Array<{ bom_id: bigint }>>`
      SELECT bom_id FROM boms
      WHERE bom_id = ${bomId} AND company_id = ${companyId} AND deleted_at IS NULL
      FOR UPDATE`;
    if (locked.length === 0) throw bomNotFound();
    return tx.bom.findUniqueOrThrow({ where: { bomId } });
  }

  findBom(db: Db, companyId: bigint, bomId: bigint) {
    return db.bom.findFirst({ where: { bomId, companyId, deletedAt: null } });
  }

  async loadItems(db: Db, companyId: bigint, ids: Array<bigint | string>): Promise<Map<string, BomItem>> {
    const unique = [...new Set(ids.map((id) => id.toString()))].filter((id) => /^\d+$/.test(id));
    const map = new Map<string, BomItem>();
    if (unique.length === 0) return map;
    const rows = await db.item.findMany({
      where: { companyId, deletedAt: null, itemId: { in: unique.map((id) => BigInt(id)) } },
      select: {
        itemId: true,
        itemCode: true,
        description: true,
        isActive: true,
        status: true,
        inventoryUomId: true,
        inventoryUom: { select: { code: true } },
      },
    });
    for (const r of rows) {
      map.set(r.itemId.toString(), {
        itemId: r.itemId.toString(),
        itemCode: r.itemCode,
        description: r.description,
        isActive: r.isActive,
        status: r.status,
        inventoryUomId: r.inventoryUomId?.toString() ?? null,
        uomCode: r.inventoryUom?.code ?? null,
      });
    }
    return map;
  }

  loadLines(db: Db, bomId: bigint) {
    return db.bomLine.findMany({ where: { bomId }, orderBy: [{ lineNumber: 'asc' }, { bomLineId: 'asc' }] });
  }

  async nextLineNumber(tx: Db, bomId: bigint, step: number): Promise<number> {
    const agg = await tx.bomLine.aggregate({ where: { bomId }, _max: { lineNumber: true } });
    return (agg._max.lineNumber ?? 0) + step;
  }

  /** rowVersion check (when sent) + bump. Call after lockBom. */
  async touch(tx: Db, bom: { bomId: bigint; rowVersion: number }, actorId: bigint | null, expected?: number, data: Prisma.BomUpdateInput = {}) {
    if (expected !== undefined && expected !== bom.rowVersion) throw rowVersionConflict();
    const { count } = await tx.bom.updateMany({
      where: { bomId: bom.bomId, rowVersion: bom.rowVersion },
      data: { ...(data as Prisma.BomUpdateManyMutationInput), updatedBy: actorId, updatedAt: new Date(), rowVersion: { increment: 1 } },
    });
    if (count === 0) throw rowVersionConflict();
  }

  writeHistory(tx: Db, row: { companyId: bigint; bomId: bigint; from: BomStatus | null; to: BomStatus; actorId: bigint | null; reason?: string | null; idempotencyKey?: string | null }) {
    return tx.bomStatusHistory.create({
      data: {
        companyId: row.companyId,
        bomId: row.bomId,
        fromStatus: row.from,
        toStatus: row.to,
        actorId: row.actorId,
        reason: row.reason ?? null,
        idempotencyKey: row.idempotencyKey ?? null,
      },
    });
  }

  /** Audit inside the caller's transaction: if it fails, the whole change rolls back. */
  writeAudit(
    tx: Db,
    row: { companyId: bigint; actorId: bigint | null; action: UserAuditAction; entityName: 'Bom' | 'BomLine'; entityId: bigint; oldValue?: unknown; newValue?: unknown },
  ) {
    const json = (v: unknown) =>
      v === undefined ? undefined : (JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))) as Prisma.InputJsonValue);
    return tx.userAudit.create({
      data: {
        companyId: row.companyId,
        performedBy: row.actorId,
        action: row.action,
        entityName: row.entityName,
        entityId: row.entityId,
        oldValue: json(row.oldValue),
        newValue: json(row.newValue),
      },
    });
  }
}
