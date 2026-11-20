import { HttpStatus, Injectable } from '@nestjs/common';
import {
  NumberSeriesConfig,
  NumberSeriesDocumentType,
  NumberSeriesLine,
  Prisma,
  UserAuditAction,
} from '@prisma/client';
import { getPaginationParams, ListQuery } from '@/common/dto/pagination.dto';
import { BusinessException, NotFoundException } from '@/common/exceptions/business.exception';
import { parseBigIntId, serialize } from '@/common/utils/bigint.util';
import { AuditService } from '@/infrastructure/audit/audit.service';
import {
  NumberSeriesAuditQueryDto,
  NumberSeriesLineInput,
  UpdateNumberSeriesDto,
} from './dto/number-series.dto';
import {
  NUMBER_SERIES_DOCUMENT_LABELS,
  NUMBER_SERIES_ERROR_CODES,
  NUMBER_SERIES_LOCKED_CONFIG_FIELDS,
  NUMBER_SERIES_LOCKED_LINE_FIELDS,
  NumberSeriesDocumentTypeValue,
  SERIAL_LENGTH_DEFAULT,
} from './number-series.constants';
import { NumberSeriesRepository } from './number-series.repository';
import { PartNumberGeneratorService } from './part-number-generator.service';
import {
  assertLockedFieldsUnchanged,
  nextPreview,
  validatePattern,
  validatePrefix,
  validateSegmentCode,
  validateSegmentSource,
  validateSerialLength,
  validateSerialReset,
  validateStartFrom,
} from './number-series.util';
import { DocumentNumberService } from './document-number.service';
import { isPatternSeriesType } from './number-series.constants';

type ConfigValues = Pick<
  NumberSeriesConfig,
  'prefix' | 'segmentSource' | 'separator' | 'serialLengthDefault' | 'serialReset' | 'pattern' | 'isActive'
>;

const CONFIG_FIELDS: (keyof ConfigValues)[] = [
  'prefix',
  'segmentSource',
  'separator',
  'serialLengthDefault',
  'serialReset',
  'pattern',
  'isActive',
];

type Category = { storeCategoryId: bigint; name: string; numberSeriesCode: string | null };

interface AuditChange {
  action: UserAuditAction;
  entityName: 'NumberSeriesConfig' | 'NumberSeriesLine';
  entityId: bigint;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  segmentName?: string;
}

/** A line has generated numbers → its code and length are fixed. */
function lineHasNumbers(line: NumberSeriesLine): boolean {
  return line.isLocked || line.lastNumber > 0;
}

/** Unchanged values are always accepted; a new value is checked against the numbers already used. */
function resolveStartFrom(requested: number | undefined, line: NumberSeriesLine | undefined, field: string): number {
  if (requested === undefined || (line && requested === line.startFrom)) return line?.startFrom ?? 1;
  return validateStartFrom(requested, line && lineHasNumbers(line) ? line : null, field);
}

function badRequest(message: string, code: string, field?: string): BusinessException {
  return new BusinessException(message, HttpStatus.BAD_REQUEST, field ? [{ field, message }] : undefined, code);
}

function conflict(): BusinessException {
  return new BusinessException(
    'Someone else saved this number series. Reload and try again.',
    HttpStatus.CONFLICT,
    undefined,
    NUMBER_SERIES_ERROR_CODES.CONFLICT,
  );
}

@Injectable()
export class NumberSeriesService {
  constructor(
    private readonly repository: NumberSeriesRepository,
    private readonly auditService: AuditService,
    private readonly partNumberGenerator: PartNumberGeneratorService,
    private readonly documentNumbers: DocumentNumberService,
  ) {}

  parseDocumentType(raw: string): NumberSeriesDocumentType {
    const value = String(raw || '').trim().toUpperCase();
    if (!(value in NUMBER_SERIES_DOCUMENT_LABELS)) throw new NotFoundException('Number series type');
    return value as NumberSeriesDocumentType;
  }

  async list(companyId: string) {
    const configs = await this.repository.findConfigs(parseBigIntId(companyId, 'companyId'));
    return (Object.keys(NUMBER_SERIES_DOCUMENT_LABELS) as NumberSeriesDocumentTypeValue[]).map((documentType) => {
      const config = configs.find((c) => c.documentType === documentType);
      return {
        documentType,
        label: NUMBER_SERIES_DOCUMENT_LABELS[documentType],
        configured: Boolean(config),
        isActive: config?.isActive ?? false,
        isLocked: config?.isLocked ?? false,
      };
    });
  }

  async get(companyId: string, documentTypeRaw: string) {
    const documentType = this.parseDocumentType(documentTypeRaw);
    return this.buildView(parseBigIntId(companyId, 'companyId'), documentType);
  }

  async preview(companyId: string, documentTypeRaw: string, segmentRefId?: string) {
    const documentType = this.parseDocumentType(documentTypeRaw);
    const cid = parseBigIntId(companyId, 'companyId');
    if (isPatternSeriesType(documentType)) {
      return { segmentRefId: null, nextNumber: await this.documentNumbers.previewNext(cid, documentType) };
    }
    const config = await this.repository.findConfig(cid, documentType);
    let ref = segmentRefId ? BigInt(segmentRefId) : null;
    if (ref !== null && config?.segmentSource === 'ITEM_GROUP') {
      ref = await this.partNumberGenerator.resolveCategoryRef(this.repository.client, cid, ref);
    }
    const line =
      config?.lines.find((l) =>
        config.segmentSource === 'NONE' ? l.segmentRefId === null : ref !== null && l.segmentRefId === ref,
      ) ?? null;
    return { segmentRefId: segmentRefId ?? null, nextNumber: nextPreview(line, config) };
  }

  async auditLog(companyId: string, query: NumberSeriesAuditQueryDto) {
    const { skip, limit } = getPaginationParams(query as ListQuery);
    const { items, total } = await this.repository.findAudit(parseBigIntId(companyId, 'companyId'), skip, limit);
    const names = await this.auditService.loadActorNames(
      items.map((row) => row.performedBy?.toString() ?? '').filter(Boolean),
    );
    return serialize({
      items: items.map((row) => {
        const oldValue = (row.oldValue ?? {}) as Record<string, unknown>;
        const newValue = (row.newValue ?? {}) as Record<string, unknown>;
        const userId = row.performedBy?.toString() ?? null;
        return {
          auditId: row.auditId,
          action: row.action,
          entityName: row.entityName,
          entityId: row.entityId,
          performedBy: { userId, name: userId ? names.get(userId) ?? null : null },
          performedAt: row.performedAt,
          field: (newValue.field ?? oldValue.field ?? null) as string | null,
          segmentName: (newValue.segmentName ?? oldValue.segmentName ?? null) as string | null,
          oldValue: oldValue.value ?? null,
          newValue: newValue.value ?? null,
        };
      }),
      total,
    });
  }

  async update(companyId: string, documentTypeRaw: string, dto: UpdateNumberSeriesDto, userId?: string) {
    const documentType = this.parseDocumentType(documentTypeRaw);
    const cid = parseBigIntId(companyId, 'companyId');
    const actor = userId && /^\d+$/.test(userId) ? BigInt(userId) : null;
    // Non-ITEM (pattern) series always use a single NONE line + period counters.
    const patternSeries = isPatternSeriesType(documentType);
    const pattern = patternSeries ? validatePattern(dto.config.pattern) : null;
    const next: ConfigValues = {
      prefix: validatePrefix(dto.config.prefix),
      segmentSource: patternSeries ? 'NONE' : validateSegmentSource(dto.config.segmentSource),
      separator: dto.config.separator,
      serialLengthDefault: validateSerialLength(dto.config.serialLengthDefault, 'config.serialLengthDefault'),
      serialReset: validateSerialReset(dto.config.serialReset, pattern),
      pattern,
      isActive: dto.config.isActive,
    };
    const changes: AuditChange[] = [];

    try {
      await this.repository.transaction(async (tx) => {
        let current = await this.repository.findConfig(cid, documentType, tx);
        if (current) {
          await this.repository.lockSeries(tx, current.numberSeriesConfigId);
          current = await this.repository.findConfig(cid, documentType, tx);
        }
        if (current && dto.config.rowVersion !== undefined && dto.config.rowVersion !== current.rowVersion) {
          throw conflict();
        }
        if (current?.isLocked) {
          assertLockedFieldsUnchanged<ConfigValues>(current, next, NUMBER_SERIES_LOCKED_CONFIG_FIELDS, 'config.');
        }

        let configId: bigint;
        if (!current) {
          const created = await tx.numberSeriesConfig.create({
            data: { companyId: cid, documentType, ...next, createdBy: actor },
          });
          configId = created.numberSeriesConfigId;
          for (const field of CONFIG_FIELDS) {
            changes.push({ action: 'create', entityName: 'NumberSeriesConfig', entityId: configId, field, oldValue: null, newValue: next[field] });
          }
        } else {
          configId = current.numberSeriesConfigId;
          const changed = CONFIG_FIELDS.filter((field) => current![field] !== next[field]);
          if (changed.length > 0) {
            const { count } = await tx.numberSeriesConfig.updateMany({
              where: { numberSeriesConfigId: configId, rowVersion: current.rowVersion },
              data: { ...next, updatedBy: actor, updatedAt: new Date(), rowVersion: { increment: 1 } },
            });
            if (count === 0) throw conflict();
            for (const field of changed) {
              changes.push({ action: 'update', entityName: 'NumberSeriesConfig', entityId: configId, field, oldValue: current[field], newValue: next[field] });
            }
          }
        }

        // Switching source (only while unlocked, so no line has numbers): the old lines point at
        // another kind of record (store vs category ids), so they are dropped.
        let existing = current?.lines ?? [];
        if (current && current.segmentSource !== next.segmentSource && existing.length > 0) {
          await tx.numberSeriesLine.deleteMany({ where: { numberSeriesConfigId: configId } });
          for (const line of existing) {
            changes.push({ action: 'delete', entityName: 'NumberSeriesLine', entityId: line.numberSeriesLineId, field: 'segmentCode', oldValue: line.segmentCode, newValue: null });
          }
          existing = [];
        }

        if (next.segmentSource === 'NONE') {
          await this.saveNoneLine(tx, cid, configId, next, existing, dto.lines, actor, changes);
        } else if (next.segmentSource === 'ITEM_GROUP') {
          await this.saveCategoryLines(tx, cid, configId, next, existing, dto.lines, actor, changes);
        } else {
          await this.saveStoreLines(tx, cid, configId, next, existing, dto.lines, actor, changes);
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = String((error.meta as { target?: unknown } | undefined)?.target ?? '');
        if (/segment_code|number_series_code|segmentCode/.test(target)) {
          throw new BusinessException(
            'This part-number code is already used by another store.',
            HttpStatus.CONFLICT,
            undefined,
            NUMBER_SERIES_ERROR_CODES.SEGMENT_CODE_EXISTS,
          );
        }
        throw conflict();
      }
      throw error;
    }

    for (const change of changes) {
      await this.auditService.log({
        companyId,
        performedBy: userId,
        action: change.action,
        entityName: change.entityName,
        entityId: change.entityId.toString(),
        oldValue: { field: change.field, value: change.oldValue, ...(change.segmentName ? { segmentName: change.segmentName } : {}) },
        newValue: { field: change.field, value: change.newValue, ...(change.segmentName ? { segmentName: change.segmentName } : {}) },
      });
    }

    return this.buildView(cid, documentType);
  }

  /**
   * Source ITEM_GROUP: one line per category that has a category code. The segment code is read
   * from the Category master (not editable here); lines for coded categories not in the request
   * are created with defaults so every category can number items.
   */
  private async saveCategoryLines(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    configId: bigint,
    config: ConfigValues,
    existing: NumberSeriesLine[],
    inputs: NumberSeriesLineInput[],
    actor: bigint | null,
    changes: AuditChange[],
  ) {
    const categories = await this.repository.findCategories(companyId, [], tx);
    const byId = new Map(categories.map((c) => [c.itemGroupId.toString(), c]));
    const inputById = new Map<string, { input: NumberSeriesLineInput; at: string }>();
    inputs.forEach((input, i) => {
      const at = `lines.${i}.`;
      if (!input.segmentRefId || !byId.has(input.segmentRefId)) {
        throw badRequest(
          'Category not found, inactive, or without a category code.',
          NUMBER_SERIES_ERROR_CODES.NOT_CONFIGURED,
          `${at}segmentRefId`,
        );
      }
      if (inputById.has(input.segmentRefId)) {
        throw badRequest('This category is listed twice.', NUMBER_SERIES_ERROR_CODES.SEGMENT_CODE_EXISTS, `${at}segmentRefId`);
      }
      inputById.set(input.segmentRefId, { input, at });
    });

    for (const category of categories) {
      const key = category.itemGroupId.toString();
      const { input, at } = inputById.get(key) ?? { input: undefined, at: `lines.${key}.` };
      const line = existing.find((l) => l.segmentRefId === category.itemGroupId);
      const code = category.categoryCode!;
      const serialLength = validateSerialLength(input?.serialLength ?? line?.serialLength ?? config.serialLengthDefault, `${at}serialLength`);
      if (line && lineHasNumbers(line)) {
        assertLockedFieldsUnchanged(line, { ...line, serialLength }, ['serialLength'], at);
      }
      const startFrom = resolveStartFrom(input?.startFrom, line, `${at}startFrom`);

      if (!line) {
        const created = await tx.numberSeriesLine.create({
          data: { numberSeriesConfigId: configId, companyId, segmentRefId: category.itemGroupId, segmentCode: code, startFrom, serialLength, createdBy: actor },
        });
        const base = { action: 'create' as UserAuditAction, entityName: 'NumberSeriesLine' as const, entityId: created.numberSeriesLineId, oldValue: null, segmentName: category.name };
        changes.push(
          { ...base, field: 'segmentCode', newValue: code },
          { ...base, field: 'startFrom', newValue: startFrom },
          { ...base, field: 'serialLength', newValue: serialLength },
        );
        continue;
      }
      if (line.segmentCode !== code && !lineHasNumbers(line)) {
        await tx.numberSeriesLine.update({ where: { numberSeriesLineId: line.numberSeriesLineId }, data: { segmentCode: code } });
        changes.push({ action: 'update', entityName: 'NumberSeriesLine', entityId: line.numberSeriesLineId, field: 'segmentCode', oldValue: line.segmentCode, newValue: code, segmentName: category.name });
      }
      await this.updateLine(tx, line, { startFrom, serialLength }, actor, changes, category.name);
    }
  }

  /** Source NONE: one counter line with no segment. */
  private async saveNoneLine(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    configId: bigint,
    config: ConfigValues,
    existing: NumberSeriesLine[],
    inputs: NumberSeriesLineInput[],
    actor: bigint | null,
    changes: AuditChange[],
  ) {
    const index = inputs.findIndex((l) => !l.segmentRefId);
    const input: Partial<NumberSeriesLineInput> = index >= 0 ? inputs[index] : {};
    const at = `lines.${Math.max(index, 0)}.`;
    const line = existing.find((l) => l.segmentRefId === null);
    const serialLength = validateSerialLength(input.serialLength ?? line?.serialLength ?? config.serialLengthDefault, `${at}serialLength`);
    const startFrom = resolveStartFrom(input.startFrom, line, `${at}startFrom`);

    if (!line) {
      const created = await tx.numberSeriesLine.create({
        data: { numberSeriesConfigId: configId, companyId, segmentRefId: null, segmentCode: '', startFrom, serialLength, createdBy: actor },
      });
      changes.push(
        { action: 'create', entityName: 'NumberSeriesLine', entityId: created.numberSeriesLineId, field: 'startFrom', oldValue: null, newValue: startFrom },
        { action: 'create', entityName: 'NumberSeriesLine', entityId: created.numberSeriesLineId, field: 'serialLength', oldValue: null, newValue: serialLength },
      );
      return;
    }
    if (lineHasNumbers(line)) {
      assertLockedFieldsUnchanged(line, { ...line, serialLength }, ['serialLength'], at);
    }
    await this.updateLine(tx, line, { startFrom, serialLength }, actor, changes);
  }

  /** Source STORE: one line per store category in the request; categories not sent are left as they are. */
  private async saveStoreLines(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    configId: bigint,
    config: ConfigValues,
    existing: NumberSeriesLine[],
    inputs: NumberSeriesLineInput[],
    actor: bigint | null,
    changes: AuditChange[],
  ) {
    const seenRefs = new Set<string>();
    inputs.forEach((input, i) => {
      if (!input.segmentRefId) {
        throw badRequest('Select a store for every line.', NUMBER_SERIES_ERROR_CODES.NOT_CONFIGURED, `lines.${i}.segmentRefId`);
      }
      if (seenRefs.has(input.segmentRefId)) {
        throw badRequest('This store is listed twice.', NUMBER_SERIES_ERROR_CODES.SEGMENT_CODE_EXISTS, `lines.${i}.segmentRefId`);
      }
      seenRefs.add(input.segmentRefId);
    });

    const refIds = [...seenRefs].map((id) => BigInt(id));
    const categories = await this.repository.findStoreCategoriesByIds(companyId, refIds, tx);
    const categoryById = new Map<string, Category>(categories.map((c) => [c.storeCategoryId.toString(), c]));

    type Plan = { input: NumberSeriesLineInput; at: string; category: Category; line?: NumberSeriesLine; code: string; startFrom: number; serialLength: number };
    const plans: Plan[] = inputs.map((input, i) => {
      const at = `lines.${i}.`;
      const category = categoryById.get(input.segmentRefId!);
      if (!category) {
        throw badRequest('Store not found for this company.', NUMBER_SERIES_ERROR_CODES.NOT_CONFIGURED, `${at}segmentRefId`);
      }
      const line = existing.find((l) => l.segmentRefId === category.storeCategoryId);
      const rawCode = String(input.segmentCode ?? '').trim();
      const code = rawCode === '' ? '' : validateSegmentCode(rawCode, `${at}segmentCode`);
      const serialLength = validateSerialLength(input.serialLength ?? line?.serialLength ?? config.serialLengthDefault, `${at}serialLength`);
      if (line && lineHasNumbers(line)) {
        assertLockedFieldsUnchanged(line, { ...line, segmentCode: code, serialLength }, NUMBER_SERIES_LOCKED_LINE_FIELDS, at);
      }
      const startFrom = code === '' ? 1 : resolveStartFrom(input.startFrom, line, `${at}startFrom`);
      return { input, at, category, line, code, startFrom, serialLength };
    });

    // Codes must be unique within the series (including lines not in this request) and the company.
    const codeOwner = new Map<string, string>();
    for (const line of existing) {
      const sentAgain = line.segmentRefId !== null && seenRefs.has(line.segmentRefId.toString());
      if (!sentAgain && line.segmentCode) codeOwner.set(line.segmentCode, 'another store in this series');
    }
    for (const plan of plans) {
      if (!plan.code) continue;
      if (codeOwner.has(plan.code)) {
        throw badRequest(`Code ${plan.code} is already used by ${codeOwner.get(plan.code)}.`, NUMBER_SERIES_ERROR_CODES.SEGMENT_CODE_EXISTS, `${plan.at}segmentCode`);
      }
      codeOwner.set(plan.code, `"${plan.category.name}"`);
    }
    const owners = await this.repository.findCategoryCodeOwners(
      companyId,
      plans.map((p) => p.code).filter(Boolean),
      refIds,
      tx,
    );
    for (const owner of owners) {
      const plan = plans.find((p) => p.code === owner.numberSeriesCode)!;
      throw badRequest(`Code ${plan.code} is already used by "${owner.name}".`, NUMBER_SERIES_ERROR_CODES.SEGMENT_CODE_EXISTS, `${plan.at}segmentCode`);
    }

    // Lines whose code changes or is cleared are unlocked: remove them first so codes can be swapped.
    for (const plan of plans) {
      if (!plan.line || plan.line.segmentCode === plan.code) continue;
      await tx.numberSeriesLine.delete({ where: { numberSeriesLineId: plan.line.numberSeriesLineId } });
      if (!plan.code) {
        changes.push({ action: 'delete', entityName: 'NumberSeriesLine', entityId: plan.line.numberSeriesLineId, field: 'segmentCode', oldValue: plan.line.segmentCode, newValue: null, segmentName: plan.category.name });
      }
    }
    const changedCategories = plans.filter((p) => (p.category.numberSeriesCode ?? '') !== p.code);
    for (const plan of changedCategories) {
      await tx.storeCategory.update({
        where: { storeCategoryId: plan.category.storeCategoryId },
        data: { numberSeriesCode: null },
      });
    }

    for (const plan of plans) {
      if (!plan.code) continue;
      if (plan.line && plan.line.segmentCode === plan.code) {
        await this.updateLine(tx, plan.line, { startFrom: plan.startFrom, serialLength: plan.serialLength }, actor, changes, plan.category.name);
        continue;
      }
      const created = await tx.numberSeriesLine.create({
        data: {
          numberSeriesConfigId: configId,
          companyId,
          segmentRefId: plan.category.storeCategoryId,
          segmentCode: plan.code,
          startFrom: plan.startFrom,
          serialLength: plan.serialLength,
          createdBy: actor,
        },
      });
      const action: UserAuditAction = plan.line ? 'update' : 'create';
      const base = { action, entityName: 'NumberSeriesLine' as const, entityId: created.numberSeriesLineId, segmentName: plan.category.name };
      changes.push({ ...base, field: 'segmentCode', oldValue: plan.line?.segmentCode ?? null, newValue: plan.code });
      if (!plan.line || plan.line.startFrom !== plan.startFrom) {
        changes.push({ ...base, field: 'startFrom', oldValue: plan.line?.startFrom ?? null, newValue: plan.startFrom });
      }
      if (!plan.line || plan.line.serialLength !== plan.serialLength) {
        changes.push({ ...base, field: 'serialLength', oldValue: plan.line?.serialLength ?? null, newValue: plan.serialLength });
      }
    }

    for (const plan of changedCategories) {
      if (!plan.code) continue;
      await tx.storeCategory.update({
        where: { storeCategoryId: plan.category.storeCategoryId },
        data: { numberSeriesCode: plan.code, updatedBy: actor, updatedAt: new Date() },
      });
    }
  }

  private async updateLine(
    tx: Prisma.TransactionClient,
    line: NumberSeriesLine,
    values: { startFrom: number; serialLength: number },
    actor: bigint | null,
    changes: AuditChange[],
    segmentName?: string,
  ) {
    const changed = (['startFrom', 'serialLength'] as const).filter((field) => line[field] !== values[field]);
    if (changed.length === 0) return;
    await tx.numberSeriesLine.update({
      where: { numberSeriesLineId: line.numberSeriesLineId },
      data: { ...values, updatedBy: actor, updatedAt: new Date() },
    });
    for (const field of changed) {
      changes.push({ action: 'update', entityName: 'NumberSeriesLine', entityId: line.numberSeriesLineId, field, oldValue: line[field], newValue: values[field], segmentName });
    }
  }

  private async buildView(companyId: bigint, documentType: NumberSeriesDocumentType) {
    const config = await this.repository.findConfig(companyId, documentType);
    const lineView = (
      line: NumberSeriesLine | undefined,
      segment: { refId: bigint; name: string; code: string | null; storeCategoryId: bigint | null; storeName: string | null } | null,
    ) => ({
      numberSeriesLineId: line?.numberSeriesLineId ?? null,
      segmentRefId: segment?.refId ?? null,
      segmentName: segment?.name ?? '',
      storeCategoryId: segment?.storeCategoryId ?? null,
      storeName: segment?.storeName ?? null,
      segmentCode: (config?.segmentSource === 'ITEM_GROUP' ? segment?.code : line?.segmentCode ?? segment?.code) ?? '',
      startFrom: line?.startFrom ?? 1,
      serialLength: line?.serialLength ?? config?.serialLengthDefault ?? SERIAL_LENGTH_DEFAULT,
      lastNumber: line?.lastNumber ?? 0,
      isLocked: line ? lineHasNumbers(line) : false,
      nextNumber: line ? nextPreview(line, config) : '',
    });

    let lines: ReturnType<typeof lineView>[];
    const lineRefs = (config?.lines ?? []).map((l) => l.segmentRefId).filter((id): id is bigint => id !== null);
    if (isPatternSeriesType(documentType)) {
      // Pattern series: single NONE line; the next number comes from the period counter.
      const nextNumber = config ? await this.documentNumbers.previewNext(companyId, documentType) : '';
      lines = [{ ...lineView(config?.lines.find((l) => l.segmentRefId === null), null), nextNumber }];
    } else if (config?.segmentSource === 'NONE') {
      lines = [lineView(config.lines.find((l) => l.segmentRefId === null), null)];
    } else if (config?.segmentSource === 'ITEM_GROUP') {
      const categories = await this.repository.findCategories(companyId, lineRefs);
      lines = categories.map((c) =>
        lineView(config.lines.find((l) => l.segmentRefId === c.itemGroupId), {
          refId: c.itemGroupId,
          name: c.name,
          code: c.categoryCode,
          storeCategoryId: c.storeCategory.storeCategoryId,
          storeName: c.storeCategory.name,
        }),
      );
    } else {
      const stores = await this.repository.findStoreCategories(companyId, lineRefs);
      lines = stores.map((s) =>
        lineView(config?.lines.find((l) => l.segmentRefId === s.storeCategoryId), {
          refId: s.storeCategoryId,
          name: s.name,
          code: s.numberSeriesCode,
          storeCategoryId: s.storeCategoryId,
          storeName: s.name,
        }),
      );
    }

    return serialize({
      documentType,
      config: config
        ? {
            prefix: config.prefix,
            segmentSource: config.segmentSource,
            separator: config.separator,
            serialLengthDefault: config.serialLengthDefault,
            serialReset: config.serialReset,
            pattern: config.pattern,
            isActive: config.isActive,
            isLocked: config.isLocked,
            updatedAt: config.updatedAt ?? config.createdAt,
            rowVersion: config.rowVersion,
          }
        : null,
      lines,
      lockedFields: config?.isLocked ? [...NUMBER_SERIES_LOCKED_CONFIG_FIELDS] : [],
    });
  }
}
