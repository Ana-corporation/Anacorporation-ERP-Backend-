import { Injectable } from '@nestjs/common';
import { BomStatus, Machine, MachineSettings, Prisma } from '@prisma/client';
import { getPaginationParams } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { checkPermissionCode } from '@/common/utils/permission-check.util';
import { resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import type { CreateItemDto } from '@/modules/inventory/item-master/dto/item.dto';
import { ItemsService } from '@/modules/inventory/item-master/items.service';
import { BomsService } from '@/modules/manufacturing/bom/boms.service';
import { IdempotencyService } from '@/modules/shared/idempotency/idempotency.service';
import {
  CreateMachineDto,
  CreateVariantDto,
  MachineListQueryDto,
  MachineLookupQueryDto,
  MachineSettingsDto,
  UpdateMachineDto,
} from './dto/machine.dto';
import {
  MACHINE_CODE_PATTERN,
  MACHINE_ERROR_CODES,
  MACHINE_ITEM_FIELD_VALUES,
  machineError,
  machineNotFound,
  SALES_ORDER_NO_PATTERN,
  variantCode,
} from './machines.constants';

type Db = Prisma.TransactionClient;

const LIST_ORDER: ListFilterOptions = {
  sortFields: ['machineCode', 'name', 'createdAt', 'updatedAt'],
  defaultSortField: 'machineCode',
  tieBreaker: 'machineId',
};

const actorOf = (user: AuthenticatedUser): bigint | null => (user?.sub && /^\d+$/.test(user.sub) ? BigInt(user.sub) : null);

function isUnique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class MachinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly items: ItemsService,
    private readonly boms: BomsService,
    private readonly idempotency: IdempotencyService,
    private readonly auditService: AuditService,
  ) {}

  private get db(): Db {
    return this.prisma as unknown as Db;
  }

  private transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => fn(tx as unknown as Db), { timeout: 120_000, maxWait: 15_000 });
  }

  // ------------------------------------------------------------- settings

  async getSettings(companyId: bigint) {
    const s = await this.db.machineSettings.findUnique({
      where: { companyId },
      include: {
        itemGroup: { select: { itemGroupId: true, name: true, categoryCode: true, storeCategory: { select: { storeCategoryId: true, name: true } } } },
        uom: { select: { uomId: true, code: true, name: true } },
      },
    });
    return serialize({ configured: Boolean(s), settings: s });
  }

  async saveSettings(companyId: bigint, dto: MachineSettingsDto, user: AuthenticatedUser) {
    const actorId = actorOf(user);
    const [group, uom] = await Promise.all([
      this.db.itemGroup.findFirst({ where: { itemGroupId: BigInt(dto.itemGroupId), companyId, deletedAt: null, isActive: true } }),
      this.db.uom.findFirst({ where: { uomId: BigInt(dto.uomId), companyId, deletedAt: null, isActive: true } }),
    ]);
    if (!group) throw machineError(MACHINE_ERROR_CODES.ITEM_NOT_FOUND, 'Category not found', 'itemGroupId');
    if (!uom) throw machineError(MACHINE_ERROR_CODES.ITEM_NOT_FOUND, 'UOM not found', 'uomId');
    await this.db.machineSettings.upsert({
      where: { companyId },
      update: { itemGroupId: group.itemGroupId, uomId: uom.uomId, updatedBy: actorId, updatedAt: new Date() },
      create: { companyId, itemGroupId: group.itemGroupId, uomId: uom.uomId, createdBy: actorId },
    });
    await this.auditService.log({
      companyId: companyId.toString(),
      performedBy: actorId?.toString(),
      action: 'update',
      entityName: 'MachineSettings',
      entityId: companyId.toString(),
      newValue: { itemGroupId: dto.itemGroupId, uomId: dto.uomId },
    });
    return this.getSettings(companyId);
  }

  // ------------------------------------------------------------- read

  async list(companyId: bigint, query: MachineListQueryDto, user: AuthenticatedUser) {
    const { skip, limit, page } = getPaginationParams(query);
    const search = query.search?.trim();
    const where: Prisma.MachineWhereInput = {
      companyId,
      deletedAt: null,
      ...(query.type ? { machineType: query.type } : {}),
      ...(query.status ? { status: query.status.toUpperCase() as Machine['status'] } : {}),
      ...(query.baseMachineId ? { baseMachineId: BigInt(query.baseMachineId) } : {}),
      ...(query.customerId ? { customerId: BigInt(query.customerId) } : {}),
      ...(search
        ? {
            OR: [
              { machineCode: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
              { series: { contains: search, mode: 'insensitive' } },
              { salesOrderNo: { contains: search, mode: 'insensitive' } },
              { item: { itemCode: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.machine.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, LIST_ORDER) as Prisma.MachineOrderByWithRelationInput,
        include: {
          item: { select: { itemId: true, itemCode: true, oldCode: true, inventoryUom: { select: { uomId: true, code: true } } } },
          baseMachine: { select: { machineId: true, machineCode: true } },
          customer: { select: { customerId: true, customerCode: true, name: true } },
          _count: { select: { variants: { where: { deletedAt: null } } } },
        },
      }),
      this.db.machine.count({ where }),
    ]);
    const currentBoms = await this.currentBoms(companyId, rows.map((r) => r.itemId));
    const items = rows.map(({ _count, ...m }) => ({
      ...m,
      variantCount: _count.variants,
      currentBom: currentBoms.get(m.itemId.toString()) ?? null,
      allowedActions: this.allowedActions(m, user),
    }));
    const withAudit = await this.auditService.withAuditList(serialize(items) as unknown as Record<string, unknown>[]);
    return toPaginatedResult(withAudit, total, page, limit);
  }

  /** BOM "Machine" dropdown: active machines only (base + customised). */
  async lookup(companyId: bigint, query: MachineLookupQueryDto) {
    const search = query.search?.trim();
    const rows = await this.db.machine.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: 'ACTIVE',
        ...(query.type ? { machineType: query.type } : {}),
        ...(search
          ? {
              OR: [
                { machineCode: { contains: search, mode: 'insensitive' } },
                { name: { contains: search, mode: 'insensitive' } },
                { item: { itemCode: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      orderBy: [{ machineCode: 'asc' }],
      take: query.limit,
      include: {
        item: { select: { itemId: true, itemCode: true, oldCode: true, inventoryUom: { select: { uomId: true, code: true } } } },
        baseMachine: { select: { machineCode: true } },
      },
    });
    const currentBoms = await this.currentBoms(companyId, rows.map((r) => r.itemId));
    return serialize({
      items: rows.map((m) => ({
        machineId: m.machineId,
        machineCode: m.machineCode,
        name: m.name,
        machineType: m.machineType,
        salesOrderNo: m.salesOrderNo,
        baseMachineCode: m.baseMachine?.machineCode ?? null,
        itemId: m.itemId,
        itemCode: m.item.itemCode,
        oldCode: m.item.oldCode,
        uom: m.item.inventoryUom,
        currentBom: currentBoms.get(m.itemId.toString()) ?? null,
      })),
    });
  }

  async get(companyId: bigint, machineId: bigint | null, user: AuthenticatedUser) {
    if (!machineId) throw machineNotFound();
    const m = await this.db.machine.findFirst({
      where: { machineId, companyId, deletedAt: null },
      include: {
        item: {
          select: {
            itemId: true,
            itemCode: true,
            oldCode: true,
            description: true,
            status: true,
            isActive: true,
            inventoryUom: { select: { uomId: true, code: true } },
            storeCategory: { select: { storeCategoryId: true, name: true } },
            itemGroupRef: { select: { itemGroupId: true, name: true, categoryCode: true } },
          },
        },
        baseMachine: { select: { machineId: true, machineCode: true, name: true } },
        customer: { select: { customerId: true, customerCode: true, name: true } },
        variants: {
          where: { deletedAt: null },
          orderBy: { machineCode: 'asc' },
          select: { machineId: true, machineCode: true, name: true, salesOrderNo: true, status: true, createdAt: true, customer: { select: { customerId: true, customerCode: true, name: true } } },
        },
      },
    });
    if (!m) throw machineNotFound();
    const boms = await this.db.bom.findMany({
      where: { companyId, parentItemId: m.itemId, deletedAt: null },
      orderBy: [{ bomNumber: 'asc' }, { version: 'desc' }],
      select: { bomId: true, bomNumber: true, version: true, revisionLabel: true, status: true, bomScope: true, bomType: true, isCurrentVersion: true, updatedAt: true, createdAt: true },
    });
    const record = { ...m, boms, allowedActions: this.allowedActions(m, user) };
    return this.auditService.withAudit(serialize(record) as unknown as Record<string, unknown>);
  }

  async listVariants(companyId: bigint, machineId: bigint | null, user: AuthenticatedUser) {
    const base = await this.findMachine(this.db, companyId, machineId);
    return this.list(companyId, { baseMachineId: base.machineId.toString(), page: 1, limit: 200 } as MachineListQueryDto, user);
  }

  // ------------------------------------------------------------- write

  async create(companyId: bigint, dto: CreateMachineDto, user: AuthenticatedUser) {
    const actorId = actorOf(user);
    const code = dto.machineCode.trim().toUpperCase();
    if (!MACHINE_CODE_PATTERN.test(code)) {
      throw machineError(MACHINE_ERROR_CODES.CODE_INVALID, 'Machine code may use A-Z, 0-9 and "-" (up to 40), e.g. BS500', 'machineCode');
    }
    let machineId: bigint;
    try {
      machineId = await this.transaction(async (tx) => {
        await this.assertCodeFree(tx, companyId, code);
        let itemId: bigint;
        if (dto.linkItemId) {
          const item = await tx.item.findFirst({ where: { itemId: BigInt(dto.linkItemId), companyId, deletedAt: null }, select: { itemId: true } });
          if (!item) throw machineError(MACHINE_ERROR_CODES.ITEM_NOT_FOUND, 'Item not found', 'linkItemId');
          const linked = await tx.machine.findFirst({ where: { itemId: item.itemId }, select: { machineCode: true } });
          if (linked) throw machineError(MACHINE_ERROR_CODES.ITEM_ALREADY_LINKED, `This item is already linked to machine ${linked.machineCode}`, 'linkItemId');
          itemId = item.itemId;
        } else {
          itemId = (await this.createMachineItem(tx, companyId, { name: dto.name, code }, actorId)).itemId;
        }
        const created = await tx.machine.create({
          data: {
            companyId,
            machineCode: code,
            name: dto.name.trim(),
            series: dto.series ?? null,
            model: dto.model ?? null,
            description: dto.description ?? null,
            remarks: dto.remarks ?? null,
            machineType: 'BASE',
            itemId,
            createdBy: actorId,
          },
        });
        await this.audit(tx, companyId, actorId, 'create', created.machineId, undefined, { machineCode: code, itemId, linkedExistingItem: Boolean(dto.linkItemId) });
        return created.machineId;
      });
    } catch (error) {
      if (isUnique(error)) throw machineError(MACHINE_ERROR_CODES.CODE_EXISTS, `Machine code ${code} already exists`, 'machineCode');
      throw error;
    }
    return this.get(companyId, machineId, user);
  }

  async update(companyId: bigint, machineId: bigint | null, dto: UpdateMachineDto, user: AuthenticatedUser) {
    const actorId = actorOf(user);
    await this.transaction(async (tx) => {
      const m = await this.findMachine(tx, companyId, machineId, true);
      if (dto.rowVersion !== m.rowVersion) {
        throw machineError(MACHINE_ERROR_CODES.ROW_VERSION_CONFLICT, 'This machine was changed by someone else. Reload and try again.', 'rowVersion');
      }
      const data: Prisma.MachineUpdateManyMutationInput = {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.series !== undefined ? { series: dto.series ?? null } : {}),
        ...(dto.model !== undefined ? { model: dto.model ?? null } : {}),
        ...(dto.description !== undefined ? { description: dto.description ?? null } : {}),
        ...(dto.remarks !== undefined ? { remarks: dto.remarks ?? null } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      };
      const { count } = await tx.machine.updateMany({
        where: { machineId: m.machineId, rowVersion: m.rowVersion },
        data: { ...data, updatedBy: actorId, updatedAt: new Date(), rowVersion: { increment: 1 } },
      });
      if (count === 0) throw machineError(MACHINE_ERROR_CODES.ROW_VERSION_CONFLICT, 'This machine was changed by someone else. Reload and try again.', 'rowVersion');
      // Name / status are mirrored onto the linked item.
      if (dto.name !== undefined || dto.status !== undefined) {
        await tx.item.update({
          where: { itemId: m.itemId },
          data: {
            ...(dto.name !== undefined ? { description: dto.name.trim() } : {}),
            ...(dto.status !== undefined ? { isActive: dto.status === 'ACTIVE', status: dto.status === 'ACTIVE' ? 'active' : 'inactive' } : {}),
            updatedBy: actorId,
            updatedAt: new Date(),
          },
        });
      }
      await this.audit(tx, companyId, actorId, 'update', m.machineId, pick(m), { ...data });
    });
    return this.get(companyId, machineId, user);
  }

  async remove(companyId: bigint, machineId: bigint | null, user: AuthenticatedUser) {
    const actorId = actorOf(user);
    await this.transaction(async (tx) => {
      const m = await this.findMachine(tx, companyId, machineId, true);
      const [bomCount, variantCount] = await Promise.all([
        tx.bom.count({ where: { companyId, parentItemId: m.itemId, deletedAt: null } }),
        tx.machine.count({ where: { companyId, baseMachineId: m.machineId, deletedAt: null } }),
      ]);
      if (bomCount || variantCount) {
        throw machineError(
          MACHINE_ERROR_CODES.IN_USE,
          `Machine ${m.machineCode} has ${bomCount} BOM(s) and ${variantCount} customised machine(s); set it inactive instead`,
        );
      }
      await tx.machine.update({ where: { machineId: m.machineId }, data: { deletedAt: new Date(), deletedBy: actorId, status: 'INACTIVE', rowVersion: { increment: 1 } } });
      await this.audit(tx, companyId, actorId, 'delete', m.machineId, pick(m));
    });
    return { message: 'Machine deleted', machineId: machineId?.toString() };
  }

  /**
   * Customised machine for one sales order: BASE code + "-" + SO number (BS500-SO00045), its item, and
   * a CUSTOMER BOM DRAFT copied from the base machine's released BOM. One transaction, idempotent.
   */
  async createVariant(companyId: bigint, baseId: bigint | null, dto: CreateVariantDto, user: AuthenticatedUser, idempotencyKey?: string) {
    const actorId = actorOf(user);
    const salesOrderNo = dto.salesOrderNo.trim().toUpperCase();
    const result = await this.transaction(async (tx) => {
      const base = await this.findMachine(tx, companyId, baseId, true);
      const { result } = await this.idempotency.run(
        tx,
        { companyId, userId: actorId, endpoint: 'POST machines/:id/variants', key: idempotencyKey, body: { baseId: base.machineId.toString(), ...dto, salesOrderNo } },
        async () => {
          if (base.machineType !== 'BASE') {
            throw machineError(MACHINE_ERROR_CODES.VARIANT_OF_VARIANT, 'Only a base machine can be customised', 'machineId');
          }
          if (!SALES_ORDER_NO_PATTERN.test(salesOrderNo)) {
            throw machineError(MACHINE_ERROR_CODES.SALES_ORDER_NO_INVALID, 'Sales order number must be SO + 5 digits, e.g. SO00045', 'salesOrderNo');
          }
          const code = variantCode(base.machineCode, salesOrderNo);
          const existing = await tx.machine.findFirst({
            where: { companyId, OR: [{ machineCode: code }, { baseMachineId: base.machineId, salesOrderNo, deletedAt: null }] },
            select: { machineId: true, machineCode: true },
          });
          if (existing) throw machineError(MACHINE_ERROR_CODES.VARIANT_EXISTS, `${existing.machineCode} already exists`, 'salesOrderNo');

          const baseBom = await tx.bom.findFirst({
            where: { companyId, parentItemId: base.itemId, bomScope: 'STANDARD', status: BomStatus.RELEASED, isCurrentVersion: true, deletedAt: null },
            orderBy: [{ bomType: 'desc' }],
          });
          if (!baseBom) {
            throw machineError(MACHINE_ERROR_CODES.BASE_BOM_NOT_RELEASED, `Release the BOM of ${base.machineCode} first; a customised machine copies the released BOM`);
          }
          let customerId: bigint | null = null;
          if (dto.customerId) {
            const customer = await tx.customer.findFirst({ where: { customerId: BigInt(dto.customerId), companyId, deletedAt: null }, select: { customerId: true } });
            if (!customer) throw machineError(MACHINE_ERROR_CODES.CUSTOMER_NOT_FOUND, 'Customer not found', 'customerId');
            customerId = customer.customerId;
          }

          const item = await this.createMachineItem(tx, companyId, { name: `${base.name} (${salesOrderNo})`, code }, actorId);
          const machine = await tx.machine.create({
            data: {
              companyId,
              machineCode: code,
              name: `${base.name} (${salesOrderNo})`,
              series: base.series,
              model: base.model,
              description: base.description,
              remarks: dto.remarks ?? null,
              machineType: 'ORDER',
              itemId: item.itemId,
              baseMachineId: base.machineId,
              salesOrderNo,
              customerId,
              createdBy: actorId,
            },
          });
          const bom = await this.boms.createCustomerCopyInTx(tx, {
            companyId,
            baseBom,
            parentItemId: item.itemId,
            uomId: item.uomId,
            customerId,
            notes: dto.remarks ?? null,
            sourceDocumentType: 'SALES_ORDER',
            actorId,
          });
          await this.audit(tx, companyId, actorId, 'create', machine.machineId, undefined, {
            machineCode: code,
            machineType: 'ORDER',
            baseMachineId: base.machineId,
            salesOrderNo,
            itemId: item.itemId,
            bomId: bom.bomId,
            baseBomId: baseBom.bomId,
          });
          return { machineId: machine.machineId.toString(), bomId: bom.bomId.toString(), bomNumber: bom.bomNumber };
        },
      );
      return result as { machineId: string; bomId: string; bomNumber: string };
    });
    const detail = await this.get(companyId, BigInt(result.machineId), user);
    return { ...detail, createdBom: { bomId: result.bomId, bomNumber: result.bomNumber } };
  }

  // ------------------------------------------------------------- helpers

  private async findMachine(db: Db, companyId: bigint, machineId: bigint | null, lock = false): Promise<Machine> {
    if (!machineId) throw machineNotFound();
    if (lock) {
      const rows = await db.$queryRaw<Array<{ machine_id: bigint }>>`
        SELECT machine_id FROM machines WHERE machine_id = ${machineId} AND company_id = ${companyId} AND deleted_at IS NULL FOR UPDATE`;
      if (!rows.length) throw machineNotFound();
    }
    const m = await db.machine.findFirst({ where: { machineId, companyId, deletedAt: null } });
    if (!m) throw machineNotFound();
    return m;
  }

  private async assertCodeFree(db: Db, companyId: bigint, code: string) {
    const clash = await db.machine.findFirst({ where: { companyId, machineCode: code }, select: { machineId: true, deletedAt: true } });
    if (clash) {
      throw machineError(
        MACHINE_ERROR_CODES.CODE_EXISTS,
        clash.deletedAt ? `Machine code ${code} was used by a deleted machine` : `Machine code ${code} already exists`,
        'machineCode',
      );
    }
  }

  private async requireSettings(db: Db, companyId: bigint): Promise<MachineSettings> {
    const s = await db.machineSettings.findUnique({ where: { companyId } });
    if (!s) {
      throw machineError(MACHINE_ERROR_CODES.SETTINGS_MISSING, 'Set the Machines category and UOM in machine settings first', 'machineSettings');
    }
    return s;
  }

  /** Item for a machine: Machines category from settings, part number from the ITEM series / AUTO. */
  private async createMachineItem(tx: Db, companyId: bigint, m: { name: string; code: string }, actorId: bigint | null) {
    const settings = await this.requireSettings(tx, companyId);
    const [group, uom] = await Promise.all([
      tx.itemGroup.findFirst({ where: { itemGroupId: settings.itemGroupId, companyId, deletedAt: null } }),
      tx.uom.findFirst({ where: { uomId: settings.uomId, companyId, deletedAt: null } }),
    ]);
    if (!group || !uom) throw machineError(MACHINE_ERROR_CODES.SETTINGS_MISSING, 'Machine settings point to a missing category or UOM', 'machineSettings');
    const item = await this.items.createInTransaction(
      tx,
      companyId.toString(),
      {
        description: m.name.trim(),
        oldCode: m.code,
        itemType: 'item',
        storeCategoryId: group.storeCategoryId.toString(),
        itemGroupId: group.itemGroupId.toString(),
        inventoryUomId: uom.uomId.toString(),
        inventory: { uomName: uom.code },
        status: 'active',
        metadata: { source: 'MACHINE', machineCode: m.code },
      } as CreateItemDto,
      actorId?.toString() ?? '',
    );
    await this.setMachineItemFields(tx, companyId, item.itemId);
    await tx.userAudit.create({
      data: { companyId, performedBy: actorId, action: 'create', entityName: 'Item', entityId: item.itemId, newValue: { itemCode: item.itemCode, description: m.name, oldCode: m.code, source: 'MACHINE' } },
    });
    return { itemId: item.itemId, itemCode: item.itemCode, uomId: uom.uomId };
  }

  /** procurementType = Make etc., only for custom fields the company has and options that exist. */
  private async setMachineItemFields(tx: Db, companyId: bigint, itemId: bigint) {
    const defs = await tx.customFieldDefinition.findMany({
      where: { companyId, entityType: 'item', deletedAt: null, isActive: true, fieldName: { in: Object.keys(MACHINE_ITEM_FIELD_VALUES) } },
    });
    for (const def of defs) {
      const wanted = MACHINE_ITEM_FIELD_VALUES[def.fieldName];
      const options = Array.isArray(def.options) ? (def.options as Array<{ value?: string }>) : [];
      if (def.fieldType === 'dropdown' && !options.some((o) => o?.value === wanted)) continue;
      await tx.customFieldValue.upsert({
        where: { fieldId_recordId: { fieldId: def.fieldId, recordId: itemId } },
        update: { valueText: wanted, updatedAt: new Date() },
        create: { companyId, entityType: 'item', recordId: itemId, fieldId: def.fieldId, valueText: wanted },
      });
    }
  }

  /** Current BOM per item: released current version, else the newest draft. */
  private async currentBoms(companyId: bigint, itemIds: bigint[]) {
    const map = new Map<string, { bomId: bigint; bomNumber: string; version: number; status: string; bomScope: string }>();
    if (!itemIds.length) return map;
    const boms = await this.db.bom.findMany({
      where: { companyId, parentItemId: { in: itemIds }, deletedAt: null, status: { in: ['RELEASED', 'DRAFT'] } },
      orderBy: [{ isCurrentVersion: 'desc' }, { version: 'desc' }],
      select: { parentItemId: true, bomId: true, bomNumber: true, version: true, status: true, bomScope: true, isCurrentVersion: true },
    });
    for (const b of boms) {
      const key = b.parentItemId.toString();
      if (!map.has(key)) map.set(key, { bomId: b.bomId, bomNumber: b.bomNumber, version: b.version, status: b.status, bomScope: b.bomScope });
    }
    return map;
  }

  private allowedActions(m: Pick<Machine, 'machineType' | 'status'>, user: AuthenticatedUser): string[] {
    const can = (code: string) => checkPermissionCode(user, code);
    const actions: string[] = [];
    if (can('machines:edit')) actions.push('edit');
    if (can('machines:delete')) actions.push('delete');
    if (m.machineType === 'BASE' && m.status === 'ACTIVE' && can('machines:create') && can('boms:create')) actions.push('createVariant');
    if (can('boms:create') && m.machineType === 'BASE') actions.push('createBom');
    return actions;
  }

  private audit(tx: Db, companyId: bigint, actorId: bigint | null, action: 'create' | 'update' | 'delete', machineId: bigint, oldValue?: unknown, newValue?: unknown) {
    const json = (v: unknown) =>
      v === undefined ? undefined : (JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))) as Prisma.InputJsonValue);
    return tx.userAudit.create({
      data: { companyId, performedBy: actorId, action, entityName: 'Machine', entityId: machineId, oldValue: json(oldValue), newValue: json(newValue) },
    });
  }
}

function pick(m: Machine) {
  return { machineCode: m.machineCode, name: m.name, series: m.series, model: m.model, status: m.status, description: m.description, remarks: m.remarks, rowVersion: m.rowVersion };
}
