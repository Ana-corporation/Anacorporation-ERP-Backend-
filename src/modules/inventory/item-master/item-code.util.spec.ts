import { formatItemCode, parseItemAutoSequence } from './item-code.util';

describe('item-code.util', () => {
  it('formats ITM-000001 style codes', () => {
    expect(formatItemCode('ITM', 1)).toBe('ITM-000001');
    expect(formatItemCode('itm', 12)).toBe('ITM-000012');
  });

  it('parses matching prefix sequences only', () => {
    expect(parseItemAutoSequence('ITM-000003', 'ITM')).toBe(3);
    expect(parseItemAutoSequence('ITM-000003', 'SKU')).toBeNull();
    expect(parseItemAutoSequence('LEGACY', 'ITM')).toBeNull();
  });
});
