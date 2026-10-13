import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import { BusinessException } from '@/common/exceptions/business.exception';

type Decimal = Prisma.Decimal;
const ZERO = new Prisma.Decimal(0);

export const STOCK_ERROR_CODES = {
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
} as const;

export interface StockLocationKey {
  itemId: bigint;
  branchId: bigint | null;
  warehouseId: bigint;
  storageBinId: bigint | null;
}

export interface StockMovementInput extends StockLocationKey {
  sourceType: string;
  sourceLineId: bigint;
  documentId: bigint | null;
  documentNumber: string;
  transactionDate: Date;
  movementType: StockMovementType;
  /** Signed: positive = IN, negative = OUT. Zero movements are skipped. */
  quantity: Decimal;
  uom: string | null;
  unitCost?: Decimal | null;
  /** Shown in errors, e.g. part number */
  label?: string;
  /** Request path for errors, e.g. lines[2].quantity */
  errorField?: string;
}

export const stockKey = (key: Pick<StockLocationKey, 'itemId' | 'warehouseId' | 'storageBinId'>) =>
  `${key.itemId}:${key.warehouseId}:${key.storageBinId ?? 0}`;

const compareKeys = (a: StockLocationKey, b: StockLocationKey) =>
  Number(a.itemId - b.itemId) ||
  Number(a.warehouseId - b.warehouseId) ||
  Number((a.storageBinId ?? 0n) - (b.storageBinId ?? 0n));

/**
 * The only writer of stock_balances, stock_ledger_entries and item_warehouse_stock.qty_on_hand.
 * Every call must run inside the caller's transaction so document status, balances and the
 * ledger commit or roll back together.
 */
@Injectable()
export class StockPostingService {
  /** Committed on-hand per key without locking (form display only; posting re-reads under lock). */
  async readBalances(
    db: Prisma.TransactionClient,
    companyId: bigint,
    keys: Array<Pick<StockLocationKey, 'itemId' | 'warehouseId' | 'storageBinId'>>,
  ): Promise<Map<string, Decimal>> {
    const result = new Map<string, Decimal>(keys.map((k) => [stockKey(k), ZERO]));
    if (keys.length === 0) return result;
    const rows = await db.stockBalance.findMany({
      where: {
        companyId,
        OR: keys.map((k) => ({
          itemId: k.itemId,
          warehouseId: k.warehouseId,
          binKey: k.storageBinId ?? 0n,
        })),
      },
      select: { itemId: true, warehouseId: true, storageBinId: true, quantity: true },
    });
    for (const row of rows) result.set(stockKey(row), new Prisma.Decimal(row.quantity));
    return result;
  }

  /**
   * Creates missing balance rows and row-locks them (FOR UPDATE) in a fixed order, so concurrent
   * postings on the same item/location wait for each other instead of overselling or deadlocking.
   */
  async lockBalances(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    keys: StockLocationKey[],
  ): Promise<Map<string, { stockBalanceId: bigint; quantity: Decimal }>> {
    const unique = new Map<string, StockLocationKey>();
    for (const key of keys) unique.set(stockKey(key), key);

    const locked = new Map<string, { stockBalanceId: bigint; quantity: Decimal }>();
    for (const key of [...unique.values()].sort(compareKeys)) {
      const binKey = key.storageBinId ?? 0n;
      await tx.$executeRaw`
        INSERT INTO stock_balances
          (company_id, item_id, branch_id, warehouse_id, storage_bin_id, bin_key, quantity, created_at)
        VALUES
          (${companyId}, ${key.itemId}, ${key.branchId}, ${key.warehouseId}, ${key.storageBinId}, ${binKey}, 0, NOW())
        ON CONFLICT (company_id, item_id, warehouse_id, bin_key) DO NOTHING`;
      const [row] = await tx.$queryRaw<Array<{ stock_balance_id: bigint; quantity: Decimal }>>`
        SELECT stock_balance_id, quantity FROM stock_balances
        WHERE company_id = ${companyId} AND item_id = ${key.itemId}
          AND warehouse_id = ${key.warehouseId} AND bin_key = ${binKey}
        FOR UPDATE`;
      locked.set(stockKey(key), {
        stockBalanceId: row.stock_balance_id,
        quantity: new Prisma.Decimal(row.quantity),
      });
    }
    return locked;
  }

  /** Applies signed movements: rejects negative stock, then writes balances, ledger and totals. */
  async applyMovements(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    actorId: bigint | null,
    movements: StockMovementInput[],
  ): Promise<void> {
    const effective = movements.filter((m) => !m.quantity.isZero());
    if (effective.length === 0) return;

    const balances = await this.lockBalances(tx, companyId, effective);
    const next = new Map<string, Decimal>();
    for (const movement of effective) {
      const key = stockKey(movement);
      const current = next.get(key) ?? balances.get(key)!.quantity;
      const after = current.add(movement.quantity);
      if (after.isNegative()) {
        const available = current.toString();
        const message = `Insufficient stock${movement.label ? ` for ${movement.label}` : ''}: available ${available}, required ${movement.quantity.negated().toString()}`;
        throw new BusinessException(
          message,
          HttpStatus.BAD_REQUEST,
          movement.errorField ? [{ field: movement.errorField, message }] : undefined,
          STOCK_ERROR_CODES.INSUFFICIENT_STOCK,
        );
      }
      next.set(key, after);
    }

    const now = new Date();
    for (const [key, quantity] of next) {
      const { stockBalanceId } = balances.get(key)!;
      await tx.stockBalance.update({
        where: { stockBalanceId },
        data: { quantity, updatedAt: now },
      });
    }

    await tx.stockLedgerEntry.createMany({
      data: effective.map((m) => {
        const qty = m.quantity.abs();
        return {
          companyId,
          transactionDate: m.transactionDate,
          movementType: m.movementType,
          sourceType: m.sourceType,
          sourceLineId: m.sourceLineId,
          documentId: m.documentId,
          documentNumber: m.documentNumber,
          itemId: m.itemId,
          branchId: m.branchId,
          warehouseId: m.warehouseId,
          storageBinId: m.storageBinId,
          qtyIn: m.quantity.isPositive() ? qty : ZERO,
          qtyOut: m.quantity.isNegative() ? qty : ZERO,
          uom: m.uom,
          unitCost: m.unitCost ?? null,
          totalValue: m.unitCost ? m.unitCost.mul(qty) : null,
          createdBy: actorId,
        };
      }),
    });

    await this.syncItemWarehouseTotals(tx, companyId, actorId, effective);
  }

  /** Keeps the Item Master warehouse tab (item_warehouse_stock.qty_on_hand) equal to the bin total. */
  private async syncItemWarehouseTotals(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    actorId: bigint | null,
    movements: StockMovementInput[],
  ) {
    const deltas = new Map<string, { itemId: bigint; warehouseId: bigint; delta: Decimal }>();
    for (const m of movements) {
      const key = `${m.itemId}:${m.warehouseId}`;
      const row = deltas.get(key) ?? { itemId: m.itemId, warehouseId: m.warehouseId, delta: ZERO };
      row.delta = row.delta.add(m.quantity);
      deltas.set(key, row);
    }
    const ordered = [...deltas.values()].sort(
      (a, b) => Number(a.itemId - b.itemId) || Number(a.warehouseId - b.warehouseId),
    );
    for (const { itemId, warehouseId, delta } of ordered) {
      if (delta.isZero()) continue;
      await tx.$executeRaw`
        INSERT INTO item_warehouse_stock (company_id, item_id, warehouse_id, qty_on_hand, created_by, created_at)
        VALUES (${companyId}, ${itemId}, ${warehouseId}, ${delta}, ${actorId}, NOW())
        ON CONFLICT (item_id, warehouse_id) DO UPDATE
        SET qty_on_hand = item_warehouse_stock.qty_on_hand + EXCLUDED.qty_on_hand,
            updated_by = EXCLUDED.created_by,
            updated_at = NOW()`;
    }
  }
}
