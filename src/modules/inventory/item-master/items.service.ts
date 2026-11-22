import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import {
  BusinessException,
  ConflictException,
  NotFoundException,
} from '@/common/exceptions/business.exception';
import { parseBigIntId, serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { DataAccessPoliciesService } from '@/modules/iam/data-access-policies/data-access-policies.service';
import { CustomFieldsValuesService } from '@/modules/shared/custom-fields/custom-fields.service';
import {
  PartNumberGeneratorService,
  PartNumberSegment,
} from '@/modules/shared/number-series/part-number-generator.service';
import {
  getBuiltInFields,
  lookupOverride,
  resolveBuiltInLabel,
  resolveBuiltInRequired,
  resolveBuiltInVisibility,
} from '@/modules/shared/form-configuration/built-in-field-registry';
import { FormConfigurationService } from '@/modules/shared/form-configuration/form-configuration.service';
import {
  ITEM_ATTACHMENT_MAX_BYTES,
  resolveItemAttachmentMime,
} from './item-attachments.constants';
import {
  CreateItemDto,
  ItemListQueryDto,
  UpdateItemDto,
  UpsertItemWarehouseStockDto,
  extractItemCfFilters,
} from './dto/item.dto';
import { formatItemCode, parseItemAutoSequence } from './item-code.util';
import { ITEM_STAGE_ERROR_CODES, ItemStagePlan, createStageItems } from './item-stages';
import { ItemsRepository } from './items.repository';

export const ITEM_ERROR_CODES = {
  CODE_EXISTS: 'ITEM_CODE_EXISTS',
  OLD_CODE_EXISTS: 'ITEM_OLD_CODE_EXISTS',
  STORE_REQUIRED: 'ITEM_STORE_REQUIRED',
  STORE_LOCKED: 'ITEM_STORE_LOCKED',
  GROUP_STORE_MISMATCH: 'ITEM_GROUP_STORE_MISMATCH',
  NAME_DUPLICATE: 'ITEM_NAME_DUPLICATE',
  IN_USE: 'ITEM_IN_USE',
  IMAGE_INVALID: 'ITEM_IMAGE_INVALID',
  REQUIRED_FIELDS: 'ITEM_REQUIRED_FIELDS',
  CODE_REQUIRED: 'ITEM_CODE_REQUIRED',
  CATEGORY_REQUIRED: 'ITEM_CATEGORY_REQUIRED',
  CATEGORY_LOCKED: 'ITEM_CATEGORY_LOCKED',
} as const;

const segmentOf = (dto: { storeCategoryId?: string; itemGroupId?: string }): PartNumberSegment => ({
  storeCategoryId: dto.storeCategoryId ? BigInt(dto.storeCategoryId) : null,
  itemGroupId: dto.itemGroupId ? BigInt(dto.itemGroupId) : null,
});

/** Generated or set by the backend, never typed by the user. */
const REQUIRED_CHECK_SKIP = new Set(['itemCode', 'imageFileAssetId']);

export const ITEM_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const ITEM_IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
const ITEM_IMAGE_ENTITY = 'item_image';

type UploadedMulterFile = {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

@Injectable()
export class ItemsService {
  constructor(
    private readonly repository: ItemsRepository,
    private readonly auditService: AuditService,
    private readonly dataAccessPoliciesService: DataAccessPoliciesService,
    private readonly storageService: StorageService,
    private readonly customFieldsValuesService: CustomFieldsValuesService,
    private readonly partNumberGenerator: PartNumberGeneratorService,
    private readonly formConfigurationService: FormConfigurationService,
  ) {}

  /**
   * Fields the company made mandatory in Form Configuration (visible + required override). On
   * create every one must have a value; on update only fields sent in the body are checked.
   * Developer defaults stay with the DTO (e.g. itemType defaults to 'item').
   */
  private async assertRequiredFields(companyId: string, dto: Record<string, unknown>, mode: 'create' | 'update') {
    const overrides = await this.formConfigurationService.loadFieldOverrides(companyId, 'item');
    if (!overrides.required?.size) return;
    const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    const errors: Array<{ field: string; message: string }> = [];
    for (const field of getBuiltInFields('item')) {
      if (REQUIRED_CHECK_SKIP.has(field.fieldKey) || !field.configurable) continue;
      if (lookupOverride(field, overrides.required) !== true) continue;
      const visible = resolveBuiltInVisibility(field, overrides.visibility);
      if (!resolveBuiltInRequired(field, visible, overrides.required)) continue;
      let sent: boolean;
      let value: unknown;
      if (field.storage.kind === 'core') {
        sent = Object.prototype.hasOwnProperty.call(dto, field.storage.apiKey);
        value = dto[field.storage.apiKey];
      } else if (field.storage.kind === 'bag') {
        const bag = dto[field.storage.bag] as Record<string, unknown> | undefined;
        sent = Boolean(bag && Object.prototype.hasOwnProperty.call(bag, field.storage.bagKey));
        value = bag?.[field.storage.bagKey];
      } else {
        continue;
      }
      if ((mode === 'create' || sent) && isEmpty(value)) {
        const path = field.storage.kind === 'bag' ? `${field.storage.bag}.${field.storage.bagKey}` : field.storage.apiKey;
        errors.push({ field: path, message: `${resolveBuiltInLabel(field, overrides.label)} is required` });
      }
    }
    if (errors.length > 0) {
      throw new BusinessException('Required fields are missing', HttpStatus.BAD_REQUEST, errors, ITEM_ERROR_CODES.REQUIRED_FIELDS);
    }
  }

  async findAll(companyId: string, query: ItemListQueryDto, _userId?: string) {
    const cfFilters = extractItemCfFilters(query as unknown as Record<string, unknown>);
    const recordIdFilter = await this.customFieldsValuesService.filterRecordIdsByCustomFields(
      companyId,
      'item',
      cfFilters,
    );
    const { items, total, page, limit } = await this.repository.findManyByCompany(
      companyId,
      query,
      recordIdFilter,
    );
    if (!query.includeCustomFields) {
      const pageResult = serialize(toPaginatedResult(items, total, page, limit));
      const withAudit = await this.auditService.withAuditList(
        pageResult.items as unknown as Record<string, unknown>[],
      );
      return { ...pageResult, items: withAudit };
    }

    const maps = await this.customFieldsValuesService.loadCustomFieldsMapsForRecords(
      companyId,
      'item',
      items.map((item) => item.itemId),
    );
    const withCf = items.map((item) => ({
      ...(serialize(item) as Record<string, unknown>),
      customFields: maps.get(item.itemId.toString()) ?? {},
    }));
    const withAudit = await this.auditService.withAuditList(withCf);
    return serialize(toPaginatedResult(withAudit, total, page, limit));
  }

  async findOne(id: string, companyId: string, userId?: string) {
    const item = await this.repository.findById(id, companyId);
    if (!item) throw new NotFoundException('Item');
    if (userId) {
      const scope = await this.dataAccessPoliciesService.resolveUserDataScope(userId, companyId);
      if (scope.isRestricted) {
        // Empty warehouse union = NO warehouse rows (spec: empty scope ≠ all data)
        item.warehouseStock = item.warehouseStock.filter((row) =>
          scope.warehouseIds.includes(row.warehouseId.toString()),
        );
      }
    }

    const withCustomFields = await this.customFieldsValuesService.mergeEntityWithCustomFields(
      companyId,
      'item',
      item.itemId.toString(),
      serialize(item) as Record<string, unknown>,
    );

    return this.auditService.withAudit(withCustomFields as Record<string, unknown>);
  }

  async create(companyId: string, dto: CreateItemDto, actorId: string) {
    const { customFields, confirmDuplicateName, stagePlan, processCategoryCode, ...itemDto } = dto;
    await this.assertRequiredFields(companyId, itemDto as Record<string, unknown>, 'create');
    await this.assertVendorInCompany(companyId, itemDto.preferredVendorId);
    await this.assertStoreCategory(companyId, itemDto.storeCategoryId);
    await this.resolveMasters(companyId, itemDto, itemDto.storeCategoryId ?? null);
    await this.assertNoDuplicateName(companyId, itemDto.storeCategoryId ?? null, itemDto.description, confirmDuplicateName);
    await this.assertUniqueOldCode(companyId, itemDto.oldCode);

    const series = await this.partNumberGenerator.findActiveItemSeries(
      this.repository.db,
      BigInt(companyId),
    );
    if (series) {
      return this.createWithNumberSeries(companyId, itemDto as CreateItemDto, customFields, actorId, series.segment_source, stagePlan, processCategoryCode);
    }

    const settings = await this.repository.getOrCreateItemSettings(companyId, actorId);
    const mode = settings.itemCodeMode;
    const prefix = settings.itemCodePrefix || 'ITM';

    let itemCode: string;

    if (mode === 'MANUAL') {
      const raw = itemDto.itemCode?.trim();
      if (!raw) {
        throw new BusinessException(
          'itemCode is required when item code mode is MANUAL',
          HttpStatus.BAD_REQUEST,
          [{ field: 'itemCode', message: 'Item code is required' }],
        );
      }
      itemCode = raw.toUpperCase();
      if (await this.repository.findAnyByCode(companyId, itemCode)) {
        throw new ConflictException('Item code already exists', ITEM_ERROR_CODES.CODE_EXISTS);
      }
    } else {
      // AUTO — backend is sole authority; ignore any client-supplied code
      itemCode = await this.allocateUniqueAutoCode(companyId, prefix);
    }

    let item;
    try {
      item = await this.repository.transaction(async (tx) => {
        const created = await this.repository.create(companyId, itemDto as CreateItemDto, itemCode, actorId, tx);
        await this.applyStagePlan(tx, companyId, created.itemId, stagePlan, processCategoryCode, actorId);
        return created;
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('Item code already exists', ITEM_ERROR_CODES.CODE_EXISTS);
      }
      throw error;
    }

    return this.afterCreate(companyId, item, customFields, actorId, mode);
  }

  /**
   * Stage of a new item from its category (RM / SF / FF), and for raw material the linked SF / FF
   * parts the user asked for. Runs in the item's create transaction.
   */
  private async applyStagePlan(
    tx: Prisma.TransactionClient,
    companyId: string,
    itemId: bigint,
    stagePlan: ItemStagePlan | undefined,
    processCategoryCode: string | undefined,
    actorId: string,
  ) {
    const item = await tx.item.findUniqueOrThrow({ where: { itemId }, select: { itemGroupRef: { select: { materialStage: true } } } });
    const categoryStage = item.itemGroupRef?.materialStage ?? null;
    if (stagePlan && stagePlan !== 'RM_ONLY' && categoryStage !== 'RM') {
      throw new BusinessException(
        'Process parts can only be created for a raw-material (RM stage) category',
        HttpStatus.BAD_REQUEST,
        [{ field: 'stagePlan', message: 'Choose an RM stage category' }],
        ITEM_STAGE_ERROR_CODES.NOT_RM,
      );
    }
    if (categoryStage) await tx.item.update({ where: { itemId }, data: { materialStage: categoryStage } });
    if (stagePlan === 'RM_PROCESS') {
      await createStageItems(tx, this.createInTransaction.bind(this), {
        companyId: BigInt(companyId),
        itemId,
        processCategoryCode: processCategoryCode ?? '',
        actorId,
      });
    }
  }

  /** Create the missing process part (PLT / MCN / …) of an existing raw-material item. */
  async createMissingStages(companyId: string, id: string, processCategoryCode: string, actorId: string) {
    const company = BigInt(companyId);
    const item = await this.repository.db.item.findFirst({
      where: { itemId: parseBigIntId(id), companyId: company, deletedAt: null },
      select: { itemId: true, materialStage: true, previousStageItemId: true },
    });
    if (!item) throw new NotFoundException('Item');
    const rmId = item.materialStage === 'SF' && item.previousStageItemId ? item.previousStageItemId : item.itemId;
    const created = await this.repository.transaction((tx) =>
      createStageItems(tx, this.createInTransaction.bind(this), {
        companyId: company,
        itemId: rmId,
        processCategoryCode,
        actorId,
      }),
    );
    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'Item',
      entityId: rmId.toString(),
      newValue: { action: 'create-stages', processCategoryCode, created: created.map((c) => c.itemCode) },
    });
    return { created: serialize(created), item: await this.findOne(rmId.toString(), companyId) };
  }

  /** Active ITEM series: client itemCode and MANUAL mode are ignored; the code is generated in the
   * same transaction as the insert, so a failed save never burns a number. */
  private async createWithNumberSeries(
    companyId: string,
    itemDto: CreateItemDto,
    customFields: CreateItemDto['customFields'],
    actorId: string,
    segmentSource: string,
    stagePlan?: ItemStagePlan,
    processCategoryCode?: string,
  ) {
    this.assertSeriesInputs(segmentSource, itemDto);

    let item;
    try {
      item = await this.repository.transaction(async (tx) => {
        const itemCode = await this.partNumberGenerator.generatePartNumber(tx, BigInt(companyId), segmentOf(itemDto));
        const created = await this.repository.create(companyId, itemDto, itemCode, actorId, tx);
        await this.applyStagePlan(tx, companyId, created.itemId, stagePlan, processCategoryCode, actorId);
        return created;
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('Item code already exists', ITEM_ERROR_CODES.CODE_EXISTS);
      }
      throw error;
    }

    return this.afterCreate(companyId, item, customFields, actorId, 'NUMBER_SERIES');
  }

  private async afterCreate(
    companyId: string,
    item: { itemId: bigint; itemCode: string; description: string },
    customFields: CreateItemDto['customFields'],
    actorId: string,
    mode: string,
  ) {
    await this.customFieldsValuesService.persistCustomFields(
      companyId,
      'item',
      item.itemId.toString(),
      customFields,
      'create',
    );

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'Item',
      entityId: item.itemId.toString(),
      newValue: { itemCode: item.itemCode, description: item.description, itemCodeMode: mode },
    });

    return this.findOne(item.itemId.toString(), companyId);
  }

  async getItemSettings(companyId: string, actorId?: string) {
    const settings = await this.repository.getOrCreateItemSettings(companyId, actorId);
    return serialize({
      companyId: settings.companyId,
      itemCodeMode: settings.itemCodeMode,
      itemCodePrefix: settings.itemCodePrefix,
      numberSeriesActive: await this.isNumberSeriesActive(companyId),
      updatedAt: settings.updatedAt,
    });
  }

  private async isNumberSeriesActive(companyId: string): Promise<boolean> {
    const series = await this.partNumberGenerator.findActiveItemSeries(this.repository.db, BigInt(companyId));
    return Boolean(series);
  }

  async updateItemSettings(
    companyId: string,
    dto: { itemCodeMode: 'AUTO' | 'MANUAL'; itemCodePrefix?: string },
    actorId: string,
  ) {
    const settings = await this.repository.updateItemSettings(companyId, dto, actorId);
    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'CompanyItemSettings',
      entityId: companyId,
      newValue: dto as Record<string, unknown>,
    });
    return serialize({
      companyId: settings.companyId,
      itemCodeMode: settings.itemCodeMode,
      itemCodePrefix: settings.itemCodePrefix,
      numberSeriesActive: await this.isNumberSeriesActive(companyId),
      updatedAt: settings.updatedAt,
    });
  }

  /**
   * Item create inside the caller's transaction (opening stock import approve). Same code rules as
   * create(): an active series generates the part number, otherwise AUTO. MANUAL companies without
   * a series cannot create items without a code. Custom fields are not set; the caller audits.
   */
  async createInTransaction(tx: Prisma.TransactionClient, companyId: string, dto: CreateItemDto, actorId: string) {
    const cid = BigInt(companyId);
    const series = await this.partNumberGenerator.findActiveItemSeries(tx, cid);
    let itemCode: string;
    if (series) {
      this.assertSeriesInputs(series.segment_source, dto);
      itemCode = await this.partNumberGenerator.generatePartNumber(tx, cid, segmentOf(dto));
    } else {
      const settings = await this.repository.getOrCreateItemSettings(companyId, actorId);
      if (settings.itemCodeMode === 'MANUAL') {
        throw new BusinessException(
          'This company uses manual item codes; new items cannot be created without a part number',
          HttpStatus.BAD_REQUEST,
          [{ field: 'itemCode', message: 'Item code required (MANUAL mode)' }],
          ITEM_ERROR_CODES.CODE_REQUIRED,
        );
      }
      itemCode = await this.allocateUniqueAutoCode(companyId, settings.itemCodePrefix || 'ITM', tx);
    }
    return this.repository.create(companyId, dto, itemCode, actorId, tx);
  }

  /**
   * Many items in one INSERT inside the caller's transaction (opening stock import). Codes follow
   * the same rules as createInTransaction: series numbers are reserved per store in one statement,
   * otherwise consecutive AUTO codes. Result order matches `dtos`.
   */
  async createManyInTransaction(tx: Prisma.TransactionClient, companyId: string, dtos: CreateItemDto[], actorId: string) {
    if (dtos.length === 0) return [];
    const cid = BigInt(companyId);
    const codes: string[] = new Array(dtos.length);
    const series = await this.partNumberGenerator.findActiveItemSeries(tx, cid);
    if (series) {
      // One reservation per counter key (category, store, or the single NONE line).
      const bySegment = new Map<string, { segment: PartNumberSegment; indexes: number[] }>();
      dtos.forEach((dto, i) => {
        this.assertSeriesInputs(series.segment_source, dto);
        const key =
          series.segment_source === 'ITEM_GROUP'
            ? `g${dto.itemGroupId}`
            : series.segment_source === 'STORE'
              ? `s${dto.storeCategoryId}`
              : '';
        const entry = bySegment.get(key) ?? { segment: segmentOf(dto), indexes: [] };
        entry.indexes.push(i);
        bySegment.set(key, entry);
      });
      for (const { segment, indexes } of bySegment.values()) {
        const reserved = await this.partNumberGenerator.reservePartNumbers(tx, cid, segment, indexes.length);
        indexes.forEach((index, k) => (codes[index] = reserved[k]));
      }
    } else {
      const settings = await this.repository.getOrCreateItemSettings(companyId, actorId);
      if (settings.itemCodeMode === 'MANUAL') {
        throw new BusinessException(
          'This company uses manual item codes; new items cannot be created without a part number',
          HttpStatus.BAD_REQUEST,
          [{ field: 'itemCode', message: 'Item code required (MANUAL mode)' }],
          ITEM_ERROR_CODES.CODE_REQUIRED,
        );
      }
      const prefix = (settings.itemCodePrefix || 'ITM').trim().toUpperCase();
      let seq = parseItemAutoSequence(await this.repository.nextAutoItemCode(companyId, prefix, tx), prefix) ?? 1;
      const free: string[] = [];
      while (free.length < dtos.length) {
        const batch = Array.from({ length: dtos.length - free.length }, () => formatItemCode(prefix, seq++));
        const taken = new Set(
          (await tx.item.findMany({ where: { companyId: cid, itemCode: { in: batch } }, select: { itemCode: true } })).map((i) => i.itemCode),
        );
        free.push(...batch.filter((code) => !taken.has(code)));
      }
      free.forEach((code, i) => (codes[i] = code));
    }

    const created = await this.repository.createMany(tx, companyId, dtos.map((dto, i) => ({ dto, itemCode: codes[i] })), actorId);
    const byCode = new Map(created.map((c) => [c.itemCode, c]));
    return codes.map((code) => byCode.get(code.toUpperCase())!);
  }

  private async allocateUniqueAutoCode(
    companyId: string,
    prefix: string,
    db: Prisma.TransactionClient = this.repository.db,
  ): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = await this.repository.nextAutoItemCode(companyId, prefix, db);
      if (!(await this.repository.findAnyByCode(companyId, candidate, db))) {
        return candidate;
      }
    }
    throw new ConflictException('Unable to allocate unique item code');
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }

  async update(id: string, companyId: string, dto: UpdateItemDto, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw new NotFoundException('Item');
    const { customFields, confirmDuplicateName, ...itemDto } = dto;
    await this.assertRequiredFields(companyId, itemDto as Record<string, unknown>, 'update');
    await this.assertVendorInCompany(companyId, itemDto.preferredVendorId);

    if (itemDto.storeCategoryId !== undefined) {
      const current = existing.storeCategoryId?.toString() ?? null;
      if (current && current !== itemDto.storeCategoryId) {
        throw new BusinessException(
          'The store of an item cannot be changed once set.',
          HttpStatus.BAD_REQUEST,
          [{ field: 'storeCategoryId', message: 'Store cannot be changed' }],
          ITEM_ERROR_CODES.STORE_LOCKED,
        );
      }
      if (current) delete itemDto.storeCategoryId;
      else await this.assertStoreCategory(companyId, itemDto.storeCategoryId);
    }

    // Category-based part numbers: the category is fixed once set (old items may set it once).
    if (itemDto.itemGroupId !== undefined && existing.itemGroupId) {
      const series = await this.partNumberGenerator.findActiveItemSeries(this.repository.db, BigInt(companyId));
      if (series?.segment_source === 'ITEM_GROUP') {
        if (existing.itemGroupId.toString() !== itemDto.itemGroupId) {
          throw new BusinessException(
            'Part number is based on the category; the category cannot be changed.',
            HttpStatus.BAD_REQUEST,
            [{ field: 'itemGroupId', message: 'Category cannot be changed' }],
            ITEM_ERROR_CODES.CATEGORY_LOCKED,
          );
        }
        delete itemDto.itemGroupId;
      }
    }

    const storeId = itemDto.storeCategoryId ?? existing.storeCategoryId?.toString() ?? null;
    await this.resolveMasters(companyId, itemDto, storeId);
    const nameChanged =
      itemDto.description !== undefined &&
      itemDto.description.trim().toLowerCase() !== existing.description.trim().toLowerCase();
    if (nameChanged || itemDto.storeCategoryId) {
      await this.assertNoDuplicateName(companyId, storeId, itemDto.description ?? existing.description, confirmDuplicateName, id);
    }
    if (itemDto.oldCode !== undefined) {
      await this.assertUniqueOldCode(companyId, itemDto.oldCode, id);
    }

    const hasItemFields = Object.values(itemDto).some((value) => value !== undefined);
    if (hasItemFields) {
      await this.repository.update(id, itemDto as UpdateItemDto, actorId);
    }

    if (customFields !== undefined) {
      await this.customFieldsValuesService.persistCustomFields(
        companyId,
        'item',
        id,
        customFields,
        'update',
      );
    }

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'Item',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return this.findOne(id, companyId);
  }

  async remove(id: string, companyId: string, actorId: string) {
    await this.assertItemExists(id, companyId);
    if (await this.repository.isUsedInInventory(id)) {
      throw new ConflictException(
        'This item has stock or inventory documents; set its status to Inactive instead',
        ITEM_ERROR_CODES.IN_USE,
      );
    }
    await this.repository.softDelete(id, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'Item',
      entityId: id,
    });

    return { message: 'Item deleted' };
  }

  async upsertWarehouseStock(
    id: string,
    companyId: string,
    dto: UpsertItemWarehouseStockDto,
    actorId: string,
  ) {
    await this.assertItemExists(id, companyId);

    const warehouse = await this.repository.findWarehouseById(dto.warehouseId, companyId);
    if (!warehouse) throw new NotFoundException('Warehouse');
    await this.dataAccessPoliciesService.assertWarehouseScope(
      actorId,
      companyId,
      dto.warehouseId,
    );

    const row = await this.repository.upsertWarehouseStock(companyId, id, dto, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'ItemWarehouseStock',
      entityId: row.itemWarehouseStockId.toString(),
      newValue: { ...dto },
    });

    return serialize(row);
  }

  async removeWarehouseStock(
    id: string,
    companyId: string,
    warehouseId: string,
    actorId: string,
  ) {
    await this.assertItemExists(id, companyId);
    await this.dataAccessPoliciesService.assertWarehouseScope(actorId, companyId, warehouseId);
    if (await this.repository.hasStockInWarehouse(id, warehouseId)) {
      throw new ConflictException(
        'This item still has stock in this location; issue or adjust it to zero first',
        'ITEM_WAREHOUSE_HAS_STOCK',
      );
    }

    const { count } = await this.repository.deleteWarehouseStock(id, warehouseId);
    if (count === 0) throw new NotFoundException('Item warehouse stock');

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'ItemWarehouseStock',
      entityId: id,
      newValue: { warehouseId },
    });

    return { message: 'Item warehouse stock removed' };
  }

  async uploadAttachments(
    itemId: string,
    companyId: string,
    files: UploadedMulterFile[],
    actorId: string,
  ) {
    await this.assertItemExists(itemId, companyId);

    if (!files.length) {
      throw new BusinessException('No files uploaded');
    }

    const attachments: Array<{
      fileAssetId: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
      storageKey: string;
      publicUrl: string | null;
      attachmentDate: string;
      status: 'uploaded';
    }> = [];

    const today = new Date().toISOString().slice(0, 10);

    for (const file of files) {
      if (!file?.buffer?.length) {
        throw new BusinessException(`Empty file: ${file?.originalname || 'unknown'}`);
      }
      if (file.size > ITEM_ATTACHMENT_MAX_BYTES) {
        throw new BusinessException(`File too large (max 10 MB): ${file.originalname}`);
      }

      const mimeType = resolveItemAttachmentMime(file.originalname, file.mimetype);
      if (!mimeType) {
        throw new BusinessException(`Unsupported file type: ${file.originalname}`);
      }

      try {
        const asset = await this.storageService.uploadFile({
          organizationId: companyId,
          buffer: file.buffer,
          originalName: file.originalname,
          mimeType,
          uploadedById: actorId,
          entityType: 'item',
          entityId: itemId,
        });

        attachments.push({
          fileAssetId: asset.id,
          fileName: asset.originalName,
          mimeType: asset.mimeType,
          fileSize: asset.sizeBytes,
          storageKey: asset.storageKey,
          publicUrl: asset.publicUrl,
          attachmentDate: today,
          status: 'uploaded',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'File upload failed';
        throw new BusinessException(
          message.includes('File upload failed') ? 'File upload failed' : message,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'ItemAttachment',
      entityId: itemId,
      newValue: { uploaded: attachments.map((a) => a.fileAssetId) },
    });

    return { attachments };
  }

  async deleteAttachment(
    itemId: string,
    companyId: string,
    fileAssetId: string,
    actorId: string,
  ) {
    await this.assertItemExists(itemId, companyId);

    const deleted = await this.storageService.deleteFile(companyId, fileAssetId, {
      entityType: 'item',
      entityId: itemId,
    });
    if (!deleted) {
      throw new NotFoundException('Attachment');
    }

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'ItemAttachment',
      entityId: itemId,
      newValue: { fileAssetId },
    });

    return {
      success: true,
      message: 'Attachment deleted',
      data: null,
    };
  }

  async getAttachmentSignedUrl(itemId: string, companyId: string, fileAssetId: string) {
    await this.assertItemExists(itemId, companyId);

    const file = await this.storageService.findFile(companyId, fileAssetId, {
      entityType: 'item',
      entityId: itemId,
    });
    if (!file) {
      throw new NotFoundException('Attachment');
    }

    const url = await this.storageService.getSignedUrl(companyId, fileAssetId);
    if (!url) {
      throw new NotFoundException('Attachment');
    }

    return { url };
  }

  private async assertItemExists(id: string, companyId: string) {
    if (!(await this.repository.findById(id, companyId))) {
      throw new NotFoundException('Item');
    }
  }

  /** Store is needed for STORE and ITEM_GROUP series; ITEM_GROUP also needs the category. */
  private assertSeriesInputs(segmentSource: string, dto: { storeCategoryId?: string; itemGroupId?: string }) {
    if (segmentSource !== 'NONE' && !dto.storeCategoryId) {
      throw new BusinessException(
        'Select a store to generate the part number.',
        HttpStatus.BAD_REQUEST,
        [{ field: 'storeCategoryId', message: 'Store is required' }],
        ITEM_ERROR_CODES.STORE_REQUIRED,
      );
    }
    if (segmentSource === 'ITEM_GROUP' && !dto.itemGroupId) {
      throw new BusinessException(
        'Select a category to generate the part number.',
        HttpStatus.BAD_REQUEST,
        [{ field: 'itemGroupId', message: 'Category is required' }],
        ITEM_ERROR_CODES.CATEGORY_REQUIRED,
      );
    }
  }

  /** Item Group (Category) must be in the item's store; the UOM code is mirrored to inventory.uomName. */
  private async resolveMasters(
    companyId: string,
    dto: { itemGroupId?: string; inventoryUomId?: string; inventory?: Record<string, unknown> },
    storeCategoryId: string | null,
  ) {
    if (dto.itemGroupId) {
      const group = await this.repository.findItemGroup(dto.itemGroupId, companyId);
      if (!group) throw new NotFoundException('Item group');
      if (storeCategoryId && group.storeCategoryId.toString() !== storeCategoryId) {
        throw new BusinessException(
          'This item group belongs to another store',
          HttpStatus.BAD_REQUEST,
          [{ field: 'itemGroupId', message: 'Pick a group of the selected store' }],
          ITEM_ERROR_CODES.GROUP_STORE_MISMATCH,
        );
      }
    }
    if (dto.inventoryUomId) {
      const uom = await this.repository.findUom(dto.inventoryUomId, companyId);
      if (!uom) throw new NotFoundException('UOM');
      dto.inventory = { ...(dto.inventory ?? {}), uomName: uom.code };
    }
  }

  /** Warn (not block) on the same description in the same store; the client confirms to save. */
  private async assertNoDuplicateName(
    companyId: string,
    storeCategoryId: string | null,
    description: string,
    confirmed: boolean | undefined,
    excludeItemId?: string,
  ) {
    if (!storeCategoryId || confirmed) return;
    const matches = await this.repository.findSameNameInStore(companyId, storeCategoryId, description, excludeItemId);
    if (matches.length === 0) return;
    const codes = matches.map((m) => m.itemCode).join(', ');
    throw new BusinessException(
      `An item with this name already exists in this store (${codes}). Save again with confirmDuplicateName to continue.`,
      HttpStatus.CONFLICT,
      [{ field: 'description', message: `Same name as ${codes}` }],
      ITEM_ERROR_CODES.NAME_DUPLICATE,
    );
  }

  /** Old / drawing number must be unique per company among live items. */
  private async assertUniqueOldCode(companyId: string, oldCode: string | null | undefined, excludeItemId?: string) {
    const code = (oldCode ?? '').trim();
    if (!code) return;
    const other = await this.repository.findByOldCode(companyId, code, excludeItemId);
    if (!other) return;
    throw new BusinessException(
      `Old Code "${code}" is already used by ${other.itemCode}`,
      HttpStatus.CONFLICT,
      [{ field: 'oldCode', message: `Already used by ${other.itemCode}` }],
      ITEM_ERROR_CODES.OLD_CODE_EXISTS,
    );
  }

  async uploadImage(itemId: string, companyId: string, file: UploadedMulterFile | undefined, actorId: string) {
    const item = await this.repository.findById(itemId, companyId);
    if (!item) throw new NotFoundException('Item');
    const ext = (file?.originalname.split('.').pop() ?? '').toLowerCase();
    const mimeType = ITEM_IMAGE_MIME[ext];
    if (!file?.buffer?.length || !mimeType || !Object.values(ITEM_IMAGE_MIME).includes(file.mimetype)) {
      throw new BusinessException(
        'Upload a PNG, JPG or WEBP image',
        HttpStatus.BAD_REQUEST,
        [{ field: 'image', message: 'PNG, JPG or WEBP only' }],
        ITEM_ERROR_CODES.IMAGE_INVALID,
      );
    }
    if (file.size > ITEM_IMAGE_MAX_BYTES) {
      throw new BusinessException(
        'Image is larger than 5 MB',
        HttpStatus.BAD_REQUEST,
        [{ field: 'image', message: 'Max 5 MB' }],
        ITEM_ERROR_CODES.IMAGE_INVALID,
      );
    }

    const asset = await this.storageService.uploadFile({
      organizationId: companyId,
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType,
      uploadedById: actorId,
      entityType: ITEM_IMAGE_ENTITY,
      entityId: itemId,
    });
    const previous = item.imageFileAssetId;
    await this.repository.setImage(itemId, asset.id, actorId);
    if (previous) {
      await this.storageService.deleteFile(companyId, previous, { entityType: ITEM_IMAGE_ENTITY, entityId: itemId });
    }

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'Item',
      entityId: itemId,
      oldValue: { imageFileAssetId: previous },
      newValue: { imageFileAssetId: asset.id },
    });
    return { imageFileAssetId: asset.id, fileName: asset.originalName, mimeType: asset.mimeType, fileSize: asset.sizeBytes };
  }

  async getImageUrl(itemId: string, companyId: string) {
    const item = await this.repository.findById(itemId, companyId);
    if (!item) throw new NotFoundException('Item');
    const url = item.imageFileAssetId ? await this.storageService.getSignedUrl(companyId, item.imageFileAssetId) : null;
    if (!url) throw new NotFoundException('Item image');
    return { url };
  }

  async deleteImage(itemId: string, companyId: string, actorId: string) {
    const item = await this.repository.findById(itemId, companyId);
    if (!item) throw new NotFoundException('Item');
    if (!item.imageFileAssetId) throw new NotFoundException('Item image');
    await this.repository.setImage(itemId, null, actorId);
    await this.storageService.deleteFile(companyId, item.imageFileAssetId, { entityType: ITEM_IMAGE_ENTITY, entityId: itemId });
    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'Item',
      entityId: itemId,
      oldValue: { imageFileAssetId: item.imageFileAssetId },
      newValue: { imageFileAssetId: null },
    });
    return { message: 'Item image removed' };
  }

  private async assertStoreCategory(companyId: string, storeCategoryId?: string) {
    if (!storeCategoryId) return;
    if (!(await this.repository.findStoreCategory(storeCategoryId, companyId))) {
      throw new NotFoundException('Store category');
    }
  }

  private async assertVendorInCompany(companyId: string, vendorId?: string) {
    if (!vendorId) return;
    if (!(await this.repository.findVendorById(vendorId, companyId))) {
      throw new NotFoundException('Preferred vendor');
    }
  }
}
