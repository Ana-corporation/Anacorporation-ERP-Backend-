import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException, ConflictException } from '@/common/exceptions/business.exception';
import {
  NUMBER_SERIES_ERROR_CODES,
  NumberSeriesSegmentSourceValue,
  NumberSeriesSeparatorValue,
} from './number-series.constants';
import { formatPartNumber } from './number-series.util';

/** Serials skipped at most when a generated code is already taken by an existing item. */
const CODE_SKIP_LIMIT = 50;

type ConfigRow = {
  number_series_config_id: bigint;
  prefix: string;
  segment_source: NumberSeriesSegmentSourceValue;
  separator: NumberSeriesSeparatorValue;
  is_active: boolean;
  is_locked: boolean;
};

type LineRow = { last_number: number; serial_length: number; segment_code: string };

/** What the item belongs to; the series' segment source decides which one is used. */
export interface PartNumberSegment {
  storeCategoryId?: bigint | null;
  /** Category (Item Group); a group without a code uses its nearest parent's code */
  itemGroupId?: bigint | null;
}

function notConfigured(message: string, field = 'storeCategoryId'): BusinessException {
  return new BusinessException(
    message,
    HttpStatus.BAD_REQUEST,
    [{ field, message }],
    NUMBER_SERIES_ERROR_CODES.NOT_CONFIGURED,
  );
}

@Injectable()
export class PartNumberGeneratorService {
  /** Active ITEM series for the company, or null (company keeps the old ITM-###### numbering). */
  async findActiveItemSeries(db: Prisma.TransactionClient, companyId: bigint): Promise<ConfigRow | null> {
    const [config] = await this.findItemSeries(db, companyId);
    return config?.is_active ? config : null;
  }

  /**
   * Category whose code numbers items of `itemGroupId`: the group itself when it has a
   * category code, otherwise its nearest parent with one. null when no group in the chain has a code.
   */
  async resolveCategoryRef(db: Prisma.TransactionClient, companyId: bigint, itemGroupId: bigint): Promise<bigint | null> {
    const [row] = await db.$queryRaw<Array<{ item_group_id: bigint }>>`
      WITH RECURSIVE chain AS (
        SELECT item_group_id, parent_id, category_code, 0 AS depth FROM item_groups
        WHERE item_group_id = ${itemGroupId} AND company_id = ${companyId} AND deleted_at IS NULL
        UNION ALL
        SELECT g.item_group_id, g.parent_id, g.category_code, c.depth + 1 FROM item_groups g
        JOIN chain c ON g.item_group_id = c.parent_id
        WHERE g.deleted_at IS NULL AND c.depth < 50
      )
      SELECT item_group_id FROM chain WHERE category_code IS NOT NULL ORDER BY depth LIMIT 1`;
    return row?.item_group_id ?? null;
  }

  /**
   * Next ITEM part number, e.g. ANABRG00001 (category), ANABO00001 (store) or ANA00001 (none).
   * Runs in the caller's transaction so the counter and the item insert commit (or roll back)
   * together. The UPDATE row-locks the line until commit, so parallel saves queue up and get
   * consecutive numbers. Numbers are never reused; a rolled-back save releases its number, a
   * failure after commit leaves a gap. Codes already held by an item are skipped.
   */
  async generatePartNumber(tx: Prisma.TransactionClient, companyId: bigint, segment: PartNumberSegment): Promise<string> {
    const config = await this.activeConfig(tx, companyId);
    const ref = await this.resolveRef(tx, companyId, config, segment);

    for (let i = 0; i < CODE_SKIP_LIMIT; i++) {
      const line = await this.advanceLine(tx, companyId, config, ref, 1);
      if (i === 0) await this.lockConfig(tx, config);
      const code = this.format(config, line, line.last_number);
      const taken = await tx.item.findFirst({ where: { companyId, itemCode: code }, select: { itemId: true } });
      if (!taken) return code;
    }
    throw new ConflictException('Could not generate a unique part number', 'ITEM_CODE_EXISTS');
  }

  /**
   * `count` consecutive part numbers for one segment in one statement (bulk create, e.g. opening
   * stock import). Same row lock and rules as generatePartNumber. Codes already held by an item
   * are replaced by further numbers via generatePartNumber.
   */
  async reservePartNumbers(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    segment: PartNumberSegment,
    count: number,
  ): Promise<string[]> {
    if (count <= 0) return [];
    const config = await this.activeConfig(tx, companyId);
    const ref = await this.resolveRef(tx, companyId, config, segment);
    const line = await this.advanceLine(tx, companyId, config, ref, count);
    await this.lockConfig(tx, config);

    const first = line.last_number - count + 1;
    const codes = Array.from({ length: count }, (_, i) => this.format(config, line, first + i));
    const taken = new Set(
      (await tx.item.findMany({ where: { companyId, itemCode: { in: codes } }, select: { itemCode: true } })).map((i) => i.itemCode),
    );
    for (let i = 0; i < codes.length; i++) {
      if (taken.has(codes[i])) codes[i] = await this.generatePartNumber(tx, companyId, segment);
    }
    return codes;
  }

  private async activeConfig(tx: Prisma.TransactionClient, companyId: bigint): Promise<ConfigRow> {
    const [config] = await this.findItemSeries(tx, companyId);
    if (!config) throw notConfigured('No item number series is set up for this company.');
    if (!config.is_active) {
      throw new BusinessException('The item number series is inactive.', HttpStatus.BAD_REQUEST, undefined, NUMBER_SERIES_ERROR_CODES.INACTIVE);
    }
    return config;
  }

  /** Counter line key: category id, store id, or null (segment source NONE). */
  private async resolveRef(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    config: ConfigRow,
    segment: PartNumberSegment,
  ): Promise<bigint | null> {
    if (config.segment_source === 'NONE') return null;
    if (config.segment_source === 'ITEM_GROUP') {
      if (!segment.itemGroupId) throw notConfigured('Select a category to generate the part number.', 'itemGroupId');
      const ref = await this.resolveCategoryRef(tx, companyId, segment.itemGroupId);
      if (!ref) {
        throw notConfigured('This category has no category code. Ask an admin to set it in the Category master.', 'itemGroupId');
      }
      return ref;
    }
    if (!segment.storeCategoryId) throw notConfigured('Select a store to generate the part number.');
    return segment.storeCategoryId;
  }

  /** Adds `count` to the line counter (respecting startFrom) and returns the new last number. */
  private async advanceLine(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    config: ConfigRow,
    ref: bigint | null,
    count: number,
  ): Promise<LineRow> {
    const [line] =
      ref === null
        ? await tx.$queryRaw<LineRow[]>`
            UPDATE number_series_lines
            SET last_number = GREATEST(last_number, start_from - 1) + ${count}, is_locked = true, updated_at = NOW()
            WHERE number_series_config_id = ${config.number_series_config_id}
              AND company_id = ${companyId} AND segment_ref_id IS NULL
            RETURNING last_number, serial_length, segment_code`
        : await tx.$queryRaw<LineRow[]>`
            UPDATE number_series_lines
            SET last_number = GREATEST(last_number, start_from - 1) + ${count}, is_locked = true, updated_at = NOW()
            WHERE number_series_config_id = ${config.number_series_config_id}
              AND company_id = ${companyId} AND segment_ref_id = ${ref} AND segment_code <> ''
            RETURNING last_number, serial_length, segment_code`;
    if (!line) {
      throw ref === null
        ? notConfigured('The item number series has no counter line.')
        : config.segment_source === 'ITEM_GROUP'
          ? notConfigured('This category has no line in the number series. Ask an admin to set it up.', 'itemGroupId')
          : notConfigured('This store has no part-number code in the number series. Ask an admin to set it up.');
    }
    return line;
  }

  private async lockConfig(tx: Prisma.TransactionClient, config: ConfigRow) {
    if (config.is_locked) return;
    await tx.$executeRaw`
      UPDATE number_series_configs SET is_locked = true, updated_at = NOW()
      WHERE number_series_config_id = ${config.number_series_config_id} AND is_locked = false`;
  }

  private format(config: ConfigRow, line: LineRow, serial: number): string {
    return formatPartNumber({
      prefix: config.prefix,
      separator: config.separator,
      segmentCode: config.segment_source === 'NONE' ? '' : line.segment_code,
      serial,
      serialLength: line.serial_length,
    });
  }

  private findItemSeries(db: Prisma.TransactionClient, companyId: bigint) {
    return db.$queryRaw<ConfigRow[]>`
      SELECT number_series_config_id, prefix, segment_source::text AS segment_source,
             separator::text AS separator, is_active, is_locked
      FROM number_series_configs
      WHERE company_id = ${companyId} AND document_type::text = 'ITEM'`;
  }
}
