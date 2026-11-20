import { BusinessException } from '@/common/exceptions/business.exception';
import { NUMBER_SERIES_ERROR_CODES } from './number-series.constants';
import {
  assertLockedFieldsUnchanged,
  fiscalYearLabel,
  formatPartNumber,
  formatPatternNumber,
  nextPreview,
  nextSerial,
  seriesPeriodKey,
  validatePattern,
  validatePrefix,
  validateSegmentCode,
  validateSegmentSource,
  validateSerialLength,
  validateSerialReset,
  validateStartFrom,
} from './number-series.util';

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof BusinessException) {
      return (e.getResponse() as { code?: string }).code;
    }
    throw e;
  }
  return undefined;
}

describe('formatPartNumber', () => {
  const base = { prefix: 'ANA', separator: 'NONE' as const, segmentCode: 'BO', serial: 1, serialLength: 5 };

  it('joins prefix, segment and padded serial without a separator', () => {
    expect(formatPartNumber(base)).toBe('ANABO00001');
  });

  it('uses hyphen and slash separators', () => {
    expect(formatPartNumber({ ...base, separator: 'HYPHEN' })).toBe('ANA-BO-00001');
    expect(formatPartNumber({ ...base, separator: 'SLASH' })).toBe('ANA/BO/00001');
  });

  it('pads to the line length (FG 4 vs BO 5)', () => {
    expect(formatPartNumber({ ...base, segmentCode: 'FG', serialLength: 4 })).toBe('ANAFG0001');
    expect(formatPartNumber({ ...base, serial: 123 })).toBe('ANABO00123');
  });

  it('leaves out an empty segment (source NONE) and an empty prefix', () => {
    expect(formatPartNumber({ ...base, segmentCode: '', separator: 'HYPHEN' })).toBe('ANA-00001');
    expect(formatPartNumber({ ...base, prefix: '', separator: 'HYPHEN' })).toBe('BO-00001');
  });

  it('uppercases the result', () => {
    expect(formatPartNumber({ ...base, prefix: 'ana', segmentCode: 'bo' })).toBe('ANABO00001');
  });

  it('allows the largest serial that fits and rejects overflow (never truncates)', () => {
    expect(formatPartNumber({ ...base, serial: 99999 })).toBe('ANABO99999');
    expect(errorCode(() => formatPartNumber({ ...base, serial: 100000 }))).toBe(
      NUMBER_SERIES_ERROR_CODES.OVERFLOW,
    );
  });
});

describe('nextSerial / nextPreview', () => {
  const config = { prefix: 'ANA', separator: 'NONE' as const, segmentSource: 'STORE' as const };
  const line = { segmentCode: 'BO', startFrom: 1, serialLength: 5, lastNumber: 0 };

  it('starts at startFrom, then continues after lastNumber', () => {
    expect(nextSerial({ startFrom: 1, lastNumber: 0 })).toBe(1);
    expect(nextSerial({ startFrom: 500, lastNumber: 0 })).toBe(500);
    expect(nextSerial({ startFrom: 1, lastNumber: 41 })).toBe(42);
    expect(nextSerial({ startFrom: 100, lastNumber: 41 })).toBe(100);
  });

  it('previews the next number', () => {
    expect(nextPreview(line, config)).toBe('ANABO00001');
    expect(nextPreview({ ...line, lastNumber: 1 }, config)).toBe('ANABO00002');
  });

  it("returns '' when not configured or the next serial would overflow", () => {
    expect(nextPreview(null, config)).toBe('');
    expect(nextPreview(line, null)).toBe('');
    expect(nextPreview({ ...line, segmentCode: '' }, config)).toBe('');
    expect(nextPreview({ ...line, serialLength: 3, lastNumber: 999 }, config)).toBe('');
  });

  it('ignores the segment code for source NONE', () => {
    expect(nextPreview({ ...line, segmentCode: '' }, { ...config, segmentSource: 'NONE' })).toBe('ANA00001');
  });
});

describe('validation', () => {
  it('prefix: uppercases, allows empty, rejects symbols and > 10 chars', () => {
    expect(validatePrefix(' ana ')).toBe('ANA');
    expect(validatePrefix('')).toBe('');
    expect(errorCode(() => validatePrefix('AN-A'))).toBe(NUMBER_SERIES_ERROR_CODES.PREFIX_INVALID);
    expect(errorCode(() => validatePrefix('ABCDEFGHIJK'))).toBe(NUMBER_SERIES_ERROR_CODES.PREFIX_INVALID);
  });

  it('segment code: 1-6 letters/digits, uppercased', () => {
    expect(validateSegmentCode('bo')).toBe('BO');
    expect(errorCode(() => validateSegmentCode(''))).toBe(NUMBER_SERIES_ERROR_CODES.SEGMENT_CODE_INVALID);
    expect(errorCode(() => validateSegmentCode('B O'))).toBe(NUMBER_SERIES_ERROR_CODES.SEGMENT_CODE_INVALID);
    expect(errorCode(() => validateSegmentCode('ABCDEFG'))).toBe(
      NUMBER_SERIES_ERROR_CODES.SEGMENT_CODE_INVALID,
    );
  });

  it('serial length: 3..8 whole numbers', () => {
    expect(validateSerialLength(3)).toBe(3);
    expect(validateSerialLength(8)).toBe(8);
    for (const bad of [2, 9, 4.5]) {
      expect(errorCode(() => validateSerialLength(bad))).toBe(NUMBER_SERIES_ERROR_CODES.SERIAL_LENGTH_INVALID);
    }
  });

  it('accepts Category / Store / None sources; rejects YEARLY reset', () => {
    expect(validateSegmentSource('STORE')).toBe('STORE');
    expect(validateSegmentSource('NONE')).toBe('NONE');
    expect(validateSegmentSource('ITEM_GROUP')).toBe('ITEM_GROUP');
    expect(errorCode(() => validateSegmentSource('OTHER' as never))).toBe(
      NUMBER_SERIES_ERROR_CODES.SOURCE_UNAVAILABLE,
    );
    expect(validateSerialReset('NEVER')).toBe('NEVER');
    expect(errorCode(() => validateSerialReset('YEARLY'))).toBe(NUMBER_SERIES_ERROR_CODES.RESET_UNSUPPORTED);
  });

  it('error carries the field path', () => {
    try {
      validateSegmentCode('??', 'lines.2.segmentCode');
      fail('expected error');
    } catch (e) {
      expect((e as BusinessException).getResponse()).toMatchObject({
        errors: [{ field: 'lines.2.segmentCode' }],
      });
    }
  });
});

describe('validateStartFrom', () => {
  it('new line: any whole number >= 1', () => {
    expect(validateStartFrom(1, null)).toBe(1);
    expect(validateStartFrom(500, null)).toBe(500);
    expect(errorCode(() => validateStartFrom(0, null))).toBe(NUMBER_SERIES_ERROR_CODES.START_FROM_TOO_LOW);
  });

  it('must be above lastNumber once numbers exist', () => {
    expect(validateStartFrom(42, { startFrom: 1, lastNumber: 41 })).toBe(42);
    expect(errorCode(() => validateStartFrom(41, { startFrom: 1, lastNumber: 41 }))).toBe(
      NUMBER_SERIES_ERROR_CODES.START_FROM_TOO_LOW,
    );
  });

  it('can only increase', () => {
    expect(validateStartFrom(100, { startFrom: 100, lastNumber: 0 })).toBe(100);
    expect(errorCode(() => validateStartFrom(50, { startFrom: 100, lastNumber: 0 }))).toBe(
      NUMBER_SERIES_ERROR_CODES.START_FROM_TOO_LOW,
    );
  });
});

describe('assertLockedFieldsUnchanged', () => {
  const current = { prefix: 'ANA', separator: 'NONE', serialLengthDefault: 5, isActive: true };

  it('allows unlocked fields to change', () => {
    expect(() =>
      assertLockedFieldsUnchanged(current, { ...current, isActive: false }, ['prefix', 'separator']),
    ).not.toThrow();
  });

  it('rejects a changed locked field with its name', () => {
    try {
      assertLockedFieldsUnchanged(current, { ...current, prefix: 'ANX' }, ['prefix', 'separator'], 'config.');
      fail('expected error');
    } catch (e) {
      expect((e as BusinessException).getResponse()).toMatchObject({
        code: NUMBER_SERIES_ERROR_CODES.LOCKED_FIELD,
        errors: [{ field: 'config.prefix' }],
      });
    }
  });
});

describe('fiscalYearLabel / seriesPeriodKey', () => {
  // India: FY starts in April → June 2026 is FY 2026-27, February 2026 is FY 2025-26.
  it('India (April start): straddles the calendar year', () => {
    expect(fiscalYearLabel(new Date(2026, 5, 15), 4)).toBe('2026-27');
    expect(fiscalYearLabel(new Date(2026, 1, 15), 4)).toBe('2025-26');
    expect(fiscalYearLabel(new Date(2026, 3, 1), 4)).toBe('2026-27');
  });

  it('January start: plain calendar year', () => {
    expect(fiscalYearLabel(new Date(2026, 5, 15), 1)).toBe('2026');
  });

  it('period keys: NEVER empty, YEARLY calendar, FISCAL_YEAR label', () => {
    const d = new Date(2026, 5, 15);
    expect(seriesPeriodKey('NEVER', d, 4)).toBe('');
    expect(seriesPeriodKey('YEARLY', d, 4)).toBe('2026');
    expect(seriesPeriodKey('FISCAL_YEAR', d, 4)).toBe('2026-27');
  });
});

describe('validatePattern', () => {
  it('empty → null (plain prefix+serial)', () => {
    expect(validatePattern('')).toBeNull();
    expect(validatePattern(undefined)).toBeNull();
  });

  it('accepts known tokens and literals, uppercases', () => {
    expect(validatePattern('{prefix}/{fy}/{seq}')).toBe('{PREFIX}/{FY}/{SEQ}');
  });

  it('rejects a pattern without {SEQ} or with unknown tokens', () => {
    expect(errorCode(() => validatePattern('{PREFIX}/{FY}'))).toBe(NUMBER_SERIES_ERROR_CODES.PATTERN_INVALID);
    expect(errorCode(() => validatePattern('{PREFIX}{WAT}{SEQ}'))).toBe(NUMBER_SERIES_ERROR_CODES.PATTERN_INVALID);
  });
});

describe('formatPatternNumber', () => {
  const base = { prefix: 'QT', serial: 1, serialLength: 4, date: new Date(2026, 5, 15), fiscalYearStartMonth: 4 };

  it('QT/2026-27/0001 from {PREFIX}/{FY}/{SEQ}', () => {
    expect(formatPatternNumber({ ...base, pattern: '{PREFIX}/{FY}/{SEQ}' })).toBe('QT/2026-27/0001');
  });

  it('null pattern → plain prefix + padded serial', () => {
    expect(formatPatternNumber({ ...base, pattern: null, prefix: 'CUS', serialLength: 5 })).toBe('CUS00001');
  });

  it('year/month tokens and serial growth past the length', () => {
    expect(formatPatternNumber({ ...base, pattern: '{PREFIX}-{YYYY}{MM}-{SEQ}', serial: 12345 })).toBe('QT-202606-12345');
    expect(formatPatternNumber({ ...base, pattern: '{YY}{SEQ}', serial: 7 })).toBe('260007');
  });
});

describe('validateSerialReset with a pattern', () => {
  it('year token in the pattern allows YEARLY and FISCAL_YEAR', () => {
    expect(validateSerialReset('FISCAL_YEAR', '{PREFIX}/{FY}/{SEQ}')).toBe('FISCAL_YEAR');
    expect(validateSerialReset('YEARLY', '{PREFIX}{YYYY}{SEQ}')).toBe('YEARLY');
  });

  it('no year part → resets rejected', () => {
    expect(errorCode(() => validateSerialReset('FISCAL_YEAR', '{PREFIX}{SEQ}'))).toBe(
      NUMBER_SERIES_ERROR_CODES.RESET_UNSUPPORTED,
    );
    expect(errorCode(() => validateSerialReset('YEARLY', null))).toBe(NUMBER_SERIES_ERROR_CODES.RESET_UNSUPPORTED);
  });
});
