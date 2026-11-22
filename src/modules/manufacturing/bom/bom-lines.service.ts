import { Injectable } from '@nestjs/common';
import { Bom, BomLine, BomStatus, Prisma } from '@prisma/client';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { BOM_ERROR_CODES, BomIssue, bomError, bomLocked, bomValidationError, FORBIDDEN_LINE_KEYS, LINE_NUMBER_STEP } from './bom.constants';
import { checkLineInput, toDecimal } from './bom-validation';
import { BomViewService } from './bom-view.service';
import { BomItem, BomsRepository, Db } from './boms.repository';
import { AddBomLineDto, BomGroupInput, BomLineInput, DeleteBomLineQueryDto, UpdateBomLineDto } from './dto/bom.dto';

const ZERO = new Prisma.Decimal(0);

export function parseId(raw: string | undefined | null): bigint | null {
  return raw && /^\d+$/.test(raw) ? BigInt(raw) : null;
}

export function actorOf(user: AuthenticatedUser): bigint | null {
  return user?.sub && /^\d+$/.test(user.sub) ? BigInt(user.sub) : null;
}

/** commonKey / lineType / parentLineId are decided by the route and the backend, never by the client. */
export function assertNoForbiddenKeys(body: unknown, path: string): void {
  if (!body || typeof body !== 'object') return;
  const sent = FORBIDDEN_LINE_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(body, k));
  if (sent.length) {
    throw bomError(
      BOM_ERROR_CODES.FIELD_NOT_ALLOWED,
      `${sent.join(', ')} cannot be sent; the backend sets ${sent.length > 1 ? 'them' : 'it'}`,
      path ? `${path}.${sent[0]}` : sent[0],
    );
  }
}

export const assertDraft = (bom: Pick<Bom, 'status'>) => {
  if (bom.status !== BomStatus.DRAFT) throw bomLocked(bom.status);
};

interface PreparedLine {
  componentItemId: bigint;
  quantity: Prisma.Decimal;
  scrapPercentage: Prisma.Decimal;
  uomId: bigint;
  findNumber: string | null;
  remarks: string | null;
}

@Injectable()
export class BomLinesService {
  constructor(
    private readonly repository: BomsRepository,
    private readonly view: BomViewService,
  ) {}

  /** Validate one input line; returns the row values or pushes issues. */
  prepare(
    input: BomLineInput,
    ctx: {
      field: string;
      items: Map<string, BomItem>;
      parentItemId: bigint;
      lineType: 'MAIN' | 'SUB';
      mainItemId?: bigint | null;
      groupItemIds?: string[];
    },
    issues: BomIssue[],
  ): PreparedLine | null {
    assertNoForbiddenKeys(input, ctx.field);
    const item = input.componentItemId ? ctx.items.get(input.componentItemId) : undefined;
    const quantity = toDecimal(input.quantity);
    const scrap = input.scrapPercentage === undefined ? ZERO : toDecimal(input.scrapPercentage);
    const found = checkLineInput({
      field: ctx.field,
      item,
      componentItemId: input.componentItemId,
      quantity,
      scrap: scrap ?? new Prisma.Decimal(-1),
      uomId: input.uomId ?? null,
      parentItemId: ctx.parentItemId.toString(),
      lineType: ctx.lineType,
      mainItemId: ctx.mainItemId?.toString() ?? null,
      groupItemIds: ctx.groupItemIds,
    });
    issues.push(...found);
    if (found.length || !item || !quantity) return null;
    return {
      componentItemId: BigInt(item.itemId),
      quantity,
      scrapPercentage: scrap ?? ZERO,
      uomId: BigInt(item.inventoryUomId!),
      findNumber: input.findNumber ?? null,
      remarks: input.remarks ?? null,
    };
  }

  /**
   * BOM Excel import: insert groups with Common Keys already chosen from Find Number
   * (integer part of MAIN find, e.g. 16 from 16 / 16.1). Never called from HTTP bodies —
   * the import service builds the keys internally.
   */
  async insertImportGroups(
    tx: Db,
    bom: Bom,
    input: Array<{ commonKey: string; main: BomLineInput; subLines: BomLineInput[] }>,
    actorId: bigint | null,
  ) {
    if (input.length === 0) return;
    const ids = input
      .flatMap((g) => [g.main.componentItemId, ...g.subLines.map((s) => s.componentItemId)])
      .filter(Boolean) as string[];
    const items = await this.repository.loadItems(tx, bom.companyId, ids);
    const issues: BomIssue[] = [];
    const planned = input.map((g, gi) => {
      const main = this.prepare(g.main, { field: `groups.${gi}.main`, items, parentItemId: bom.parentItemId, lineType: 'MAIN' }, issues);
      const seen: string[] = [];
      const subs = g.subLines.map((s, si) => {
        const row = this.prepare(
          s,
          {
            field: `groups.${gi}.subLines.${si}`,
            items,
            parentItemId: bom.parentItemId,
            lineType: 'SUB',
            mainItemId: g.main.componentItemId ? BigInt(g.main.componentItemId) : null,
            groupItemIds: [...seen],
          },
          issues,
        );
        if (s.componentItemId) seen.push(s.componentItemId);
        return row;
      });
      return { commonKey: g.commonKey, main, subs };
    });
    if (issues.length) throw bomValidationError(issues);

    let lineNumber = 0;
    let maxKey = bom.nextCommonKey - 1;
    for (const g of planned) {
      const keyNum = Number(g.commonKey);
      if (Number.isFinite(keyNum) && keyNum > maxKey) maxKey = keyNum;
      const main = await tx.bomLine.create({
        data: {
          ...g.main!,
          companyId: bom.companyId,
          bomId: bom.bomId,
          lineType: 'MAIN',
          commonKey: g.commonKey,
          lineNumber: (lineNumber += LINE_NUMBER_STEP),
        },
      });
      for (const sub of g.subs) {
        await tx.bomLine.create({
          data: {
            ...sub!,
            companyId: bom.companyId,
            bomId: bom.bomId,
            lineType: 'SUB',
            commonKey: g.commonKey,
            parentLineId: main.bomLineId,
            lineNumber: (lineNumber += LINE_NUMBER_STEP),
          },
        });
      }
    }
    await tx.bom.update({ where: { bomId: bom.bomId }, data: { nextCommonKey: maxKey + 1 } });
  }

  /**
   * Inserts MAIN groups (keys from bom.nextCommonKey) and their SUB lines for a freshly created
   * draft. All lines are validated first; nothing is written when any line fails.
   */
  async insertGroups(tx: Db, bom: Bom, input: BomGroupInput[], actorId: bigint | null) {
    if (input.length === 0) return;
    const groups = input.map((g) => ({ ...g, main: g.main ?? {}, subLines: g.subLines ?? [] }));
    const ids = groups.flatMap((g) => [g.main.componentItemId, ...g.subLines.map((s) => s.componentItemId)]).filter(Boolean) as string[];
    const items = await this.repository.loadItems(tx, bom.companyId, ids);
    const issues: BomIssue[] = [];
    const planned = groups.map((g, gi) => {
      assertNoForbiddenKeys(g, `groups.${gi}`);
      const main = this.prepare(g.main, { field: `groups.${gi}.main`, items, parentItemId: bom.parentItemId, lineType: 'MAIN' }, issues);
      const seen: string[] = [];
      const subs = g.subLines.map((s, si) => {
        const row = this.prepare(
          s,
          {
            field: `groups.${gi}.subLines.${si}`,
            items,
            parentItemId: bom.parentItemId,
            lineType: 'SUB',
            mainItemId: g.main.componentItemId ? BigInt(g.main.componentItemId) : null,
            groupItemIds: [...seen],
          },
          issues,
        );
        if (s.componentItemId) seen.push(s.componentItemId);
        return row;
      });
      return { main, subs };
    });
    if (issues.length) throw bomValidationError(issues);

    let key = bom.nextCommonKey;
    let lineNumber = 0;
    for (const g of planned) {
      const commonKey = String(key++);
      const main = await tx.bomLine.create({
        data: { ...g.main!, companyId: bom.companyId, bomId: bom.bomId, lineType: 'MAIN', commonKey, lineNumber: (lineNumber += LINE_NUMBER_STEP) },
      });
      for (const sub of g.subs) {
        await tx.bomLine.create({
          data: { ...sub!, companyId: bom.companyId, bomId: bom.bomId, lineType: 'SUB', commonKey, parentLineId: main.bomLineId, lineNumber: (lineNumber += LINE_NUMBER_STEP) },
        });
      }
    }
    await tx.bom.update({ where: { bomId: bom.bomId }, data: { nextCommonKey: key } });
  }

  /** New MAIN: row lock on the BOM, take nextCommonKey, increment it, insert the MAIN (one transaction). */
  async addMain(companyId: bigint, bomId: bigint, dto: AddBomLineDto, user: AuthenticatedUser) {
    const actorId = actorOf(user);
    const line = await this.repository.transaction(async (tx) => {
      const bom = await this.repository.lockBom(tx, companyId, bomId);
      assertDraft(bom);
      const { rowVersion, ...input } = dto;
      const items = await this.repository.loadItems(tx, companyId, input.componentItemId ? [input.componentItemId] : []);
      const issues: BomIssue[] = [];
      const row = this.prepare(input, { field: 'line', items, parentItemId: bom.parentItemId, lineType: 'MAIN' }, issues);
      if (issues.length) throw bomValidationError(issues);

      const commonKey = String(bom.nextCommonKey);
      const created = await tx.bomLine.create({
        data: {
          ...row!,
          companyId,
          bomId,
          lineType: 'MAIN',
          commonKey,
          parentLineId: null,
          lineNumber: await this.repository.nextLineNumber(tx, bomId, LINE_NUMBER_STEP),
        },
      });
      await this.repository.touch(tx, bom, actorId, rowVersion, { nextCommonKey: { increment: 1 } });
      await this.repository.writeAudit(tx, { companyId, actorId, action: 'create', entityName: 'BomLine', entityId: created.bomLineId, newValue: pickLine(created) });
      return created;
    });
    return this.view.detail(companyId, bomId, user, { affectedLineId: line.bomLineId.toString(), commonKey: line.commonKey });
  }

  /** New SUB under a MAIN of this BOM: inherits bomId + commonKey, parentLineId = the MAIN. */
  async addSub(companyId: bigint, bomId: bigint, mainLineId: bigint | null, dto: AddBomLineDto, user: AuthenticatedUser) {
    const actorId = actorOf(user);
    const line = await this.repository.transaction(async (tx) => {
      const bom = await this.repository.lockBom(tx, companyId, bomId);
      const main = mainLineId
        ? await tx.bomLine.findFirst({ where: { bomLineId: mainLineId, bomId, companyId } })
        : null;
      if (!main) throw bomError(BOM_ERROR_CODES.MAIN_LINE_NOT_FOUND, 'MAIN line not found in this BOM', 'mainLineId');
      if (main.lineType !== 'MAIN') {
        throw bomError(BOM_ERROR_CODES.SUB_PARENT_MUST_BE_MAIN, 'A SUB line can only be added under a MAIN line', 'mainLineId');
      }
      assertDraft(bom);
      const { rowVersion, ...input } = dto;
      const siblings = await tx.bomLine.findMany({ where: { bomId, parentLineId: main.bomLineId }, select: { componentItemId: true } });
      const items = await this.repository.loadItems(tx, companyId, input.componentItemId ? [input.componentItemId] : []);
      const issues: BomIssue[] = [];
      const row = this.prepare(
        input,
        {
          field: 'line',
          items,
          parentItemId: bom.parentItemId,
          lineType: 'SUB',
          mainItemId: main.componentItemId,
          groupItemIds: siblings.map((s) => s.componentItemId.toString()),
        },
        issues,
      );
      if (issues.length) throw bomValidationError(issues);

      const created = await tx.bomLine.create({
        data: {
          ...row!,
          companyId,
          bomId: main.bomId,
          lineType: 'SUB',
          commonKey: main.commonKey,
          parentLineId: main.bomLineId,
          lineNumber: await this.repository.nextLineNumber(tx, bomId, LINE_NUMBER_STEP),
        },
      });
      await this.repository.touch(tx, bom, actorId, rowVersion);
      await this.repository.writeAudit(tx, { companyId, actorId, action: 'create', entityName: 'BomLine', entityId: created.bomLineId, newValue: pickLine(created) });
      return created;
    });
    return this.view.detail(companyId, bomId, user, { affectedLineId: line.bomLineId.toString(), commonKey: line.commonKey });
  }

  /** Item / quantity / find number / scrap / remarks. Never lineType, commonKey or parentLineId. */
  async updateLine(companyId: bigint, bomId: bigint, lineId: bigint | null, dto: UpdateBomLineDto, user: AuthenticatedUser) {
    assertNoForbiddenKeys(dto, '');
    const actorId = actorOf(user);
    await this.repository.transaction(async (tx) => {
      const bom = await this.repository.lockBom(tx, companyId, bomId);
      const line = lineId ? await tx.bomLine.findFirst({ where: { bomLineId: lineId, bomId, companyId } }) : null;
      if (!line) throw bomError(BOM_ERROR_CODES.LINE_NOT_FOUND, 'BOM line not found', 'lineId');
      assertDraft(bom);
      const { rowVersion, ...input } = dto;

      const componentItemId = input.componentItemId ?? line.componentItemId.toString();
      let mainItemId: bigint | null = null;
      let groupItemIds: string[] = [];
      if (line.lineType === 'SUB') {
        const main = await tx.bomLine.findUniqueOrThrow({ where: { bomLineId: line.parentLineId! } });
        mainItemId = main.componentItemId;
        groupItemIds = (
          await tx.bomLine.findMany({ where: { bomId, parentLineId: main.bomLineId, NOT: { bomLineId: line.bomLineId } }, select: { componentItemId: true } })
        ).map((s) => s.componentItemId.toString());
      }
      const items = await this.repository.loadItems(tx, companyId, [componentItemId]);
      const issues: BomIssue[] = [];
      const row = this.prepare(
        {
          componentItemId,
          quantity: input.quantity ?? line.quantity.toString(),
          scrapPercentage: input.scrapPercentage ?? line.scrapPercentage.toString(),
          uomId: input.uomId,
          findNumber: input.findNumber,
          remarks: input.remarks,
        },
        { field: 'line', items, parentItemId: bom.parentItemId, lineType: line.lineType, mainItemId, groupItemIds },
        issues,
      );
      // A MAIN's own SUB lines may not use the MAIN's (new) item.
      if (line.lineType === 'MAIN' && input.componentItemId && input.componentItemId !== line.componentItemId.toString()) {
        const clash = await tx.bomLine.findFirst({ where: { bomId, parentLineId: line.bomLineId, componentItemId: BigInt(input.componentItemId) } });
        if (clash) {
          issues.push({ field: 'line.componentItemId', code: BOM_ERROR_CODES.SELF_REFERENCE, message: 'A SUB line of this MAIN already uses that item' });
        }
      }
      if (issues.length) throw bomValidationError(issues);

      const data = {
        componentItemId: row!.componentItemId,
        quantity: row!.quantity,
        scrapPercentage: row!.scrapPercentage,
        uomId: row!.uomId,
        ...(input.findNumber !== undefined ? { findNumber: input.findNumber ?? null } : {}),
        ...(input.remarks !== undefined ? { remarks: input.remarks ?? null } : {}),
        updatedAt: new Date(),
      };
      const updated = await tx.bomLine.update({ where: { bomLineId: line.bomLineId }, data });
      await this.repository.touch(tx, bom, actorId, rowVersion);
      await this.repository.writeAudit(tx, {
        companyId,
        actorId,
        action: 'update',
        entityName: 'BomLine',
        entityId: line.bomLineId,
        oldValue: pickLine(line),
        newValue: pickLine(updated),
      });
    });
    return this.view.detail(companyId, bomId, user, { affectedLineId: lineId?.toString() });
  }

  /** MAIN with SUB lines needs withSubLines=true; then MAIN and its SUB lines go in one transaction. */
  async deleteLine(companyId: bigint, bomId: bigint, lineId: bigint | null, query: DeleteBomLineQueryDto, user: AuthenticatedUser) {
    const actorId = actorOf(user);
    await this.repository.transaction(async (tx) => {
      const bom = await this.repository.lockBom(tx, companyId, bomId);
      const line = lineId ? await tx.bomLine.findFirst({ where: { bomLineId: lineId, bomId, companyId } }) : null;
      if (!line) throw bomError(BOM_ERROR_CODES.LINE_NOT_FOUND, 'BOM line not found', 'lineId');
      assertDraft(bom);
      const subs = line.lineType === 'MAIN' ? await tx.bomLine.findMany({ where: { bomId, parentLineId: line.bomLineId } }) : [];
      if (subs.length && !query.withSubLines) {
        throw bomError(
          BOM_ERROR_CODES.MAIN_HAS_SUB_LINES,
          `This MAIN line has ${subs.length} SUB line(s). Delete with withSubLines=true to remove them too.`,
          'withSubLines',
        );
      }
      if (subs.length) await tx.bomLine.deleteMany({ where: { bomId, parentLineId: line.bomLineId } });
      await tx.bomLine.delete({ where: { bomLineId: line.bomLineId } });
      await this.repository.touch(tx, bom, actorId, query.rowVersion);
      await this.repository.writeAudit(tx, {
        companyId,
        actorId,
        action: 'delete',
        entityName: 'BomLine',
        entityId: line.bomLineId,
        oldValue: { ...pickLine(line), subLines: subs.map(pickLine) },
      });
    });
    return this.view.detail(companyId, bomId, user, { affectedLineId: lineId?.toString() });
  }
}

function pickLine(l: BomLine) {
  return {
    bomId: l.bomId.toString(),
    lineId: l.bomLineId.toString(),
    lineType: l.lineType,
    commonKey: l.commonKey,
    parentLineId: l.parentLineId?.toString() ?? null,
    componentItemId: l.componentItemId.toString(),
    quantity: l.quantity.toString(),
    scrapPercentage: l.scrapPercentage.toString(),
    uomId: l.uomId.toString(),
    lineNumber: l.lineNumber,
    findNumber: l.findNumber,
    remarks: l.remarks,
  };
}
