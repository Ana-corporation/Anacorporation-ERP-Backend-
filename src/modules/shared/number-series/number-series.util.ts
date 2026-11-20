import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '@/common/exceptions/business.exception';
import {
  NUMBER_SERIES_ERROR_CODES,
  NUMBER_SERIES_SEGMENT_SOURCE_LABELS,
  NUMBER_SERIES_SEPARATOR_CHAR,
  NumberSeriesResetValue,
  NumberSeriesSegmentSourceValue,
  NumberSeriesSeparatorValue,
  PATTERN_MAX_LENGTH,
  PATTERN_TOKENS,
  PREFIX_PATTERN,
  SEGMENT_CODE_PATTERN,
  SERIAL_LENGTH_MAX,
  SERIAL_LENGTH_MIN,
} from './number-series.constants';

export interface PartNumberParts {
  prefix: string;
  separator: NumberSeriesSeparatorValue;
  /** '' for segment source NONE */
  segmentCode: string;
  serial: number;
  serialLength: number;
}

export interface SeriesConfigLike {
  prefix: string;
  separator: NumberSeriesSeparatorValue;
  segmentSource: NumberSeriesSegmentSourceValue;
  isActive?: boolean;
}

export interface SeriesLineLike {
  segmentCode: string;
  startFrom: number;
  serialLength: number;
  lastNumber: number;
}

function invalid(message: string, code: string, field?: string): BusinessException {
  return new BusinessException(
    message,
    HttpStatus.BAD_REQUEST,
    field ? [{ field, message }] : undefined,
    code,
  );
}

/** ANA + BO + 1 (5) → ANABO00001; with HYPHEN → ANA-BO-00001; empty parts are left out. */
export function formatPartNumber(parts: PartNumberParts): string {
  const digits = String(parts.serial);
  if (digits.length > parts.serialLength) {
    throw new BusinessException(
      `Serial ${digits} needs more than ${parts.serialLength} digits. Increase the serial length or start a new segment.`,
      HttpStatus.CONFLICT,
      undefined,
      NUMBER_SERIES_ERROR_CODES.OVERFLOW,
    );
  }
  return [parts.prefix, parts.segmentCode, digits.padStart(parts.serialLength, '0')]
    .filter(Boolean)
    .join(NUMBER_SERIES_SEPARATOR_CHAR[parts.separator])
    .toUpperCase();
}

/** Serial the next generated number will use; lastNumber 0 means nothing generated yet. */
export function nextSerial(line: Pick<SeriesLineLike, 'startFrom' | 'lastNumber'>): number {
  return Math.max(line.lastNumber + 1, line.startFrom);
}

/**
 * Formatted next number without consuming it. '' when the line is not ready (no segment code
 * for STORE) or the next serial would overflow.
 */
export function nextPreview(line: SeriesLineLike | null, config: SeriesConfigLike | null): string {
  if (!line || !config) return '';
  const segmentCode = config.segmentSource === 'NONE' ? '' : line.segmentCode;
  if (config.segmentSource !== 'NONE' && !segmentCode) return '';
  const serial = nextSerial(line);
  if (String(serial).length > line.serialLength) return '';
  return formatPartNumber({
    prefix: config.prefix,
    separator: config.separator,
    segmentCode,
    serial,
    serialLength: line.serialLength,
  });
}

/** Trimmed + uppercased prefix (may be empty). */
export function validatePrefix(raw: unknown, field = 'config.prefix'): string {
  const value = String(raw ?? '').trim().toUpperCase();
  if (!PREFIX_PATTERN.test(value)) {
    throw invalid(
      'Prefix may only contain letters A-Z and digits 0-9 (up to 10).',
      NUMBER_SERIES_ERROR_CODES.PREFIX_INVALID,
      field,
    );
  }
  return value;
}

/** Trimmed + uppercased segment code, 1-6 letters/digits. */
export function validateSegmentCode(raw: unknown, field = 'segmentCode'): string {
  const value = String(raw ?? '').trim().toUpperCase();
  if (!SEGMENT_CODE_PATTERN.test(value)) {
    throw invalid(
      'Segment code must be 1 to 6 letters A-Z or digits 0-9.',
      NUMBER_SERIES_ERROR_CODES.SEGMENT_CODE_INVALID,
      field,
    );
  }
  return value;
}

export function validateSerialLength(value: number, field = 'serialLength'): number {
  if (!Number.isInteger(value) || value < SERIAL_LENGTH_MIN || value > SERIAL_LENGTH_MAX) {
    throw invalid(
      `Serial length must be between ${SERIAL_LENGTH_MIN} and ${SERIAL_LENGTH_MAX}.`,
      NUMBER_SERIES_ERROR_CODES.SERIAL_LENGTH_INVALID,
      field,
    );
  }
  return value;
}

/** Category (ITEM_GROUP), Store or None. */
export function validateSegmentSource(
  value: NumberSeriesSegmentSourceValue,
  field = 'config.segmentSource',
): NumberSeriesSegmentSourceValue {
  if (!(value in NUMBER_SERIES_SEGMENT_SOURCE_LABELS)) {
    throw invalid('Segment source must be Category, Store or None.', NUMBER_SERIES_ERROR_CODES.SOURCE_UNAVAILABLE, field);
  }
  return value;
}

const PATTERN_YEAR_TOKEN_RE = /\{(FY|YYYY|YY)\}/;

/**
 * A reset repeats serials each period, so the number needs a year part ({FY}/{YYYY}/{YY}
 * in the pattern) to stay unique. Plain prefix+serial formats only support NEVER.
 */
export function validateSerialReset(
  value: NumberSeriesResetValue,
  pattern: string | null = null,
  field = 'config.serialReset',
): NumberSeriesResetValue {
  if (value !== 'NEVER' && !(pattern && PATTERN_YEAR_TOKEN_RE.test(pattern))) {
    throw invalid(
      'A yearly or fiscal-year reset needs a year part in the number pattern ({FY}, {YYYY} or {YY}), otherwise numbers would repeat.',
      NUMBER_SERIES_ERROR_CODES.RESET_UNSUPPORTED,
      field,
    );
  }
  return value;
}

/** Trimmed pattern; must contain {SEQ}; only known tokens and A-Z 0-9 - / . space literals. */
export function validatePattern(raw: unknown, field = 'config.pattern'): string | null {
  const value = String(raw ?? '').trim().toUpperCase();
  if (!value) return null;
  if (value.length > PATTERN_MAX_LENGTH) {
    throw invalid(`Pattern may be at most ${PATTERN_MAX_LENGTH} characters.`, NUMBER_SERIES_ERROR_CODES.PATTERN_INVALID, field);
  }
  if (!value.includes('{SEQ}')) {
    throw invalid('Pattern must contain {SEQ} (the running number).', NUMBER_SERIES_ERROR_CODES.PATTERN_INVALID, field);
  }
  const literals = PATTERN_TOKENS.reduce((rest, token) => rest.split(token).join(''), value);
  if (/[{}]/.test(literals) || !/^[A-Z0-9/. -]*$/.test(literals)) {
    throw invalid(
      `Pattern may only use the tokens ${PATTERN_TOKENS.join(' ')} and letters, digits, "/", "-", "." or spaces.`,
      NUMBER_SERIES_ERROR_CODES.PATTERN_INVALID,
      field,
    );
  }
  return value;
}

/** "2026" when the fiscal year starts in January; "2026-27" otherwise (FY start Apr 2026 → 2026-27). */
export function fiscalYearLabel(date: Date, fiscalYearStartMonth: number): string {
  const year = date.getFullYear();
  const startYear = date.getMonth() + 1 >= fiscalYearStartMonth ? year : year - 1;
  if (fiscalYearStartMonth <= 1) return String(startYear);
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** Counter period: '' (NEVER) | '2026' (YEARLY) | '2026-27' (FISCAL_YEAR). */
export function seriesPeriodKey(
  reset: NumberSeriesResetValue,
  date: Date,
  fiscalYearStartMonth: number,
): string {
  if (reset === 'YEARLY') return String(date.getFullYear());
  if (reset === 'FISCAL_YEAR') return fiscalYearLabel(date, fiscalYearStartMonth);
  return '';
}

export interface PatternNumberParts {
  /** Null = plain "{PREFIX}{SEQ}" */
  pattern: string | null;
  prefix: string;
  serial: number;
  serialLength: number;
  date: Date;
  fiscalYearStartMonth: number;
}

/** QT/{FY}/{SEQ} style document number. The serial grows past serialLength instead of failing. */
export function formatPatternNumber(parts: PatternNumberParts): string {
  const pattern = parts.pattern ?? '{PREFIX}{SEQ}';
  const serial = String(parts.serial).padStart(parts.serialLength, '0');
  return pattern
    .split('{PREFIX}').join(parts.prefix)
    .split('{FY}').join(fiscalYearLabel(parts.date, parts.fiscalYearStartMonth))
    .split('{YYYY}').join(String(parts.date.getFullYear()))
    .split('{YY}').join(String(parts.date.getFullYear() % 100).padStart(2, '0'))
    .split('{MM}').join(String(parts.date.getMonth() + 1).padStart(2, '0'))
    .split('{SEQ}').join(serial)
    .toUpperCase();
}

/** startFrom ≥ 1, never lowered, and above lastNumber once numbers exist. */
export function validateStartFrom(
  startFrom: number,
  current: Pick<SeriesLineLike, 'startFrom' | 'lastNumber'> | null,
  field = 'startFrom',
): number {
  if (!Number.isInteger(startFrom) || startFrom < 1) {
    throw invalid('Start from must be a whole number of at least 1.', NUMBER_SERIES_ERROR_CODES.START_FROM_TOO_LOW, field);
  }
  if (!current) return startFrom;
  if (current.lastNumber > 0 && startFrom <= current.lastNumber) {
    throw invalid(
      `Start from must be greater than the last number used (${current.lastNumber}).`,
      NUMBER_SERIES_ERROR_CODES.START_FROM_TOO_LOW,
      field,
    );
  }
  if (startFrom < current.startFrom) {
    throw invalid(
      `Start from can only be increased (currently ${current.startFrom}).`,
      NUMBER_SERIES_ERROR_CODES.START_FROM_TOO_LOW,
      field,
    );
  }
  return startFrom;
}

/** Throws NUMBER_SERIES_LOCKED_FIELD for the first locked field whose value changes. */
export function assertLockedFieldsUnchanged<T extends object>(
  current: T,
  next: T,
  fields: readonly (keyof T & string)[],
  fieldPrefix = '',
): void {
  for (const key of fields) {
    if (current[key] !== next[key]) {
      throw invalid(
        `${key} cannot be changed after numbers have been generated.`,
        NUMBER_SERIES_ERROR_CODES.LOCKED_FIELD,
        `${fieldPrefix}${key}`,
      );
    }
  }
}
