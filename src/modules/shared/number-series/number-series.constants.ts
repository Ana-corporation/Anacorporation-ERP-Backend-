/** Same labels as the Prisma enums (number_series_* in enums.prisma). */
export type NumberSeriesDocumentTypeValue = 'ITEM' | 'CUSTOMER' | 'SALES_QUOTATION' | 'EMPLOYEE' | 'BOM';
export type NumberSeriesSegmentSourceValue = 'STORE' | 'ITEM_GROUP' | 'NONE';
export type NumberSeriesSeparatorValue = 'NONE' | 'HYPHEN' | 'SLASH';
export type NumberSeriesResetValue = 'NEVER' | 'YEARLY' | 'FISCAL_YEAR';

export const NUMBER_SERIES_DOCUMENT_LABELS: Record<NumberSeriesDocumentTypeValue, string> = {
  ITEM: 'Item / Part Number',
  CUSTOMER: 'Customer Code',
  SALES_QUOTATION: 'Sales Quotation',
  EMPLOYEE: 'Employee Code',
  BOM: 'Bill of Materials',
};

/** Non-ITEM types: one NONE line + period counters; ITEM keeps its segment lines untouched. */
export type PatternSeriesDocumentType = Exclude<NumberSeriesDocumentTypeValue, 'ITEM'>;

export function isPatternSeriesType(
  documentType: NumberSeriesDocumentTypeValue,
): documentType is PatternSeriesDocumentType {
  return documentType !== 'ITEM';
}

/** Used when a company reserves its first number before configuring the series. */
export const PATTERN_SERIES_DEFAULTS: Record<
  PatternSeriesDocumentType,
  {
    prefix: string;
    serialLength: number;
    serialReset: NumberSeriesResetValue;
    pattern: string | null;
  }
> = {
  CUSTOMER: { prefix: 'CUS', serialLength: 5, serialReset: 'NEVER', pattern: null },
  SALES_QUOTATION: { prefix: 'QT', serialLength: 4, serialReset: 'FISCAL_YEAR', pattern: '{PREFIX}/{FY}/{SEQ}' },
  EMPLOYEE: { prefix: 'EMP', serialLength: 5, serialReset: 'NEVER', pattern: null },
  BOM: { prefix: 'BOM', serialLength: 5, serialReset: 'NEVER', pattern: null },
};

/** {PREFIX} {FY} {YYYY} {YY} {MM} {SEQ}; everything else in the pattern is a literal. */
export const PATTERN_TOKENS = ['{PREFIX}', '{FY}', '{YYYY}', '{YY}', '{MM}', '{SEQ}'] as const;
export const PATTERN_MAX_LENGTH = 60;

/** Shown in the settings page; part number = prefix + segment code + serial. */
export const NUMBER_SERIES_SEGMENT_SOURCE_LABELS: Record<NumberSeriesSegmentSourceValue, string> = {
  ITEM_GROUP: 'Category (Item Group)',
  STORE: 'Store',
  NONE: 'None',
};

export const NUMBER_SERIES_SEPARATOR_CHAR: Record<NumberSeriesSeparatorValue, string> = {
  NONE: '',
  HYPHEN: '-',
  SLASH: '/',
};

export const SERIAL_LENGTH_MIN = 3;
export const SERIAL_LENGTH_MAX = 8;
export const SERIAL_LENGTH_DEFAULT = 5;

export const PREFIX_PATTERN = /^[A-Z0-9]{0,10}$/;
export const SEGMENT_CODE_PATTERN = /^[A-Z0-9]{1,6}$/;

/** Cannot change once the series has generated its first number. */
export const NUMBER_SERIES_LOCKED_CONFIG_FIELDS = [
  'prefix',
  'segmentSource',
  'separator',
  'serialLengthDefault',
  'pattern',
] as const;

/** Cannot change once the line has generated its first number. */
export const NUMBER_SERIES_LOCKED_LINE_FIELDS = ['segmentCode', 'serialLength'] as const;

export const NUMBER_SERIES_ERROR_CODES = {
  NOT_CONFIGURED: 'NUMBER_SERIES_NOT_CONFIGURED',
  INACTIVE: 'NUMBER_SERIES_INACTIVE',
  OVERFLOW: 'NUMBER_SERIES_OVERFLOW',
  LOCKED_FIELD: 'NUMBER_SERIES_LOCKED_FIELD',
  START_FROM_TOO_LOW: 'NUMBER_SERIES_START_FROM_TOO_LOW',
  SEGMENT_CODE_INVALID: 'NUMBER_SERIES_SEGMENT_CODE_INVALID',
  SEGMENT_CODE_EXISTS: 'NUMBER_SERIES_SEGMENT_CODE_EXISTS',
  SOURCE_UNAVAILABLE: 'NUMBER_SERIES_SOURCE_UNAVAILABLE',
  RESET_UNSUPPORTED: 'NUMBER_SERIES_RESET_UNSUPPORTED',
  PREFIX_INVALID: 'NUMBER_SERIES_PREFIX_INVALID',
  SERIAL_LENGTH_INVALID: 'NUMBER_SERIES_SERIAL_LENGTH_INVALID',
  CONFLICT: 'NUMBER_SERIES_CONFLICT',
  PATTERN_INVALID: 'NUMBER_SERIES_PATTERN_INVALID',
} as const;
