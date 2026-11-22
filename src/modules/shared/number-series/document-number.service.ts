import { HttpStatus, Injectable } from '@nestjs/common';
import { NumberSeriesDocumentType, Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { BusinessException } from '@/common/exceptions/business.exception';
import {
  NUMBER_SERIES_DOCUMENT_LABELS,
  NUMBER_SERIES_ERROR_CODES,
  PATTERN_SERIES_DEFAULTS,
  PatternSeriesDocumentType,
} from './number-series.constants';
import { formatPatternNumber, seriesPeriodKey } from './number-series.util';

type Db = Prisma.TransactionClient;

interface SeriesState {
  configId: bigint;
  prefix: string;
  pattern: string | null;
  serialReset: 'NEVER' | 'YEARLY' | 'FISCAL_YEAR';
  serialLength: number;
  startFrom: number;
  isActive: boolean;
  isLocked: boolean;
  fiscalYearStartMonth: number;
}

/**
 * Document numbers for pattern-based series (CUSTOMER, SALES_QUOTATION): a single running
 * counter per reset period in number_series_counters, incremented atomically with
 * INSERT … ON CONFLICT … RETURNING. ITEM part numbers keep their own generator
 * (PartNumberGeneratorService) and are not touched here.
 */
@Injectable()
export class DocumentNumberService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reserve the next number inside the caller's transaction (number is lost if it rolls back —
   * gaps are accepted). Creates the default series config on first use.
   */
  async reserve(
    tx: Db,
    companyId: bigint,
    documentType: PatternSeriesDocumentType,
    date: Date = new Date(),
  ): Promise<string> {
    const state = await this.loadState(tx, companyId, documentType, true);
    if (!state!.isActive) {
      throw new BusinessException(
        `The ${NUMBER_SERIES_DOCUMENT_LABELS[documentType]} number series is inactive.`,
        HttpStatus.CONFLICT,
        undefined,
        NUMBER_SERIES_ERROR_CODES.INACTIVE,
      );
    }
    const periodKey = seriesPeriodKey(state!.serialReset, date, state!.fiscalYearStartMonth);

    const rows = await tx.$queryRaw<{ last_number: number }[]>`
      INSERT INTO number_series_counters (number_series_config_id, company_id, period_key, last_number)
      VALUES (${state!.configId}, ${companyId}, ${periodKey}, ${state!.startFrom})
      ON CONFLICT (number_series_config_id, period_key)
      DO UPDATE SET
        last_number = GREATEST(number_series_counters.last_number + 1, ${state!.startFrom}),
        updated_at = CURRENT_TIMESTAMP
      RETURNING last_number`;
    const serial = rows[0].last_number;

    if (!state!.isLocked) {
      await tx.numberSeriesConfig.updateMany({
        where: { numberSeriesConfigId: state!.configId, isLocked: false },
        data: { isLocked: true },
      });
    }

    return this.format(state!, serial, date);
  }

  /** Next number without consuming it ('' only when nothing can be previewed). */
  async previewNext(
    companyId: bigint,
    documentType: PatternSeriesDocumentType,
    date: Date = new Date(),
  ): Promise<string> {
    const db = this.prisma as unknown as Db;
    const state = await this.loadState(db, companyId, documentType, false);
    if (!state) {
      // Not configured yet: preview what the defaults would generate.
      const defaults = PATTERN_SERIES_DEFAULTS[documentType];
      const company = await db.company.findUnique({
        where: { companyId },
        select: { fiscalYearStartMonth: true },
      });
      return formatPatternNumber({
        pattern: defaults.pattern,
        prefix: defaults.prefix,
        serial: 1,
        serialLength: defaults.serialLength,
        date,
        fiscalYearStartMonth: company?.fiscalYearStartMonth ?? 1,
      });
    }
    const periodKey = seriesPeriodKey(state.serialReset, date, state.fiscalYearStartMonth);
    const counter = await db.numberSeriesCounter.findUnique({
      where: { numberSeriesConfigId_periodKey: { numberSeriesConfigId: state.configId, periodKey } },
      select: { lastNumber: true },
    });
    const serial = Math.max((counter?.lastNumber ?? 0) + 1, state.startFrom);
    return this.format(state, serial, date);
  }

  private format(state: SeriesState, serial: number, date: Date): string {
    return formatPatternNumber({
      pattern: state.pattern,
      prefix: state.prefix,
      serial,
      serialLength: state.serialLength,
      date,
      fiscalYearStartMonth: state.fiscalYearStartMonth,
    });
  }

  private async loadState(
    db: Db,
    companyId: bigint,
    documentType: PatternSeriesDocumentType,
    createIfMissing: boolean,
  ): Promise<SeriesState | null> {
    const company = await db.company.findUniqueOrThrow({
      where: { companyId },
      select: { fiscalYearStartMonth: true },
    });

    let config = await db.numberSeriesConfig.findUnique({
      where: { companyId_documentType: { companyId, documentType: documentType as NumberSeriesDocumentType } },
      include: { lines: { where: { segmentRefId: null }, take: 1 } },
    });

    if (!config) {
      if (!createIfMissing) return null;
      const defaults = PATTERN_SERIES_DEFAULTS[documentType];
      config = await db.numberSeriesConfig.create({
        data: {
          companyId,
          documentType: documentType as NumberSeriesDocumentType,
          prefix: defaults.prefix,
          segmentSource: 'NONE',
          separator: 'NONE',
          serialLengthDefault: defaults.serialLength,
          serialReset: defaults.serialReset,
          pattern: defaults.pattern,
        },
        include: { lines: { where: { segmentRefId: null }, take: 1 } },
      });
    }

    const line = config.lines[0];
    return {
      configId: config.numberSeriesConfigId,
      prefix: config.prefix,
      pattern: config.pattern,
      serialReset: config.serialReset,
      serialLength: line?.serialLength ?? config.serialLengthDefault,
      startFrom: line?.startFrom ?? 1,
      isActive: config.isActive,
      isLocked: config.isLocked,
      fiscalYearStartMonth: company.fiscalYearStartMonth,
    };
  }
}
