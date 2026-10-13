import { computeDisplayOrders, fieldOrderKey } from './field-order.util';

describe('computeDisplayOrders', () => {
  const builtIns = [
    { fieldKey: 'a', sectionKey: 's' },
    { fieldKey: 'b', sectionKey: 's' },
    { fieldKey: 'c', sectionKey: 's' },
    { fieldKey: 'x', sectionKey: 'other' },
  ];
  const ordered = (orders: Map<string, number>) =>
    [...orders.entries()]
      .filter(([id]) => id !== fieldOrderKey('BUILT_IN', 'x'))
      .sort((l, r) => l[1] - r[1])
      .map(([id]) => id);

  it('uses registry order then custom sort_order when nothing is saved', () => {
    const orders = computeDisplayOrders({
      builtIns,
      customs: [
        { fieldName: 'z', sectionKey: 's', sortOrder: 5 },
        { fieldName: 'y', sectionKey: 's', sortOrder: 1 },
        { fieldName: 'free', sectionKey: null, sortOrder: 0 },
      ],
      savedBuiltInOrder: new Map(),
    });
    expect(ordered(orders).filter((id) => id !== 'CUSTOM:free')).toEqual([
      'BUILT_IN:a',
      'BUILT_IN:b',
      'BUILT_IN:c',
      'CUSTOM:y',
      'CUSTOM:z',
    ]);
    expect(orders.get('BUILT_IN:a')).toBe(1);
    expect(orders.get('CUSTOM:z')).toBe(5);
    expect(orders.get('BUILT_IN:x')).toBe(1);
    expect(orders.get('CUSTOM:free')).toBe(1);
  });

  it('shares one number space once a section is saved; unplaced built-ins go last', () => {
    const orders = computeDisplayOrders({
      builtIns,
      customs: [{ fieldName: 'y', sectionKey: 's', sortOrder: 1 }],
      savedBuiltInOrder: new Map([
        ['c', 2],
        ['a', 3],
      ]),
    });
    expect(ordered(orders)).toEqual(['CUSTOM:y', 'BUILT_IN:c', 'BUILT_IN:a', 'BUILT_IN:b']);
    expect(orders.get('BUILT_IN:b')).toBe(4);
    expect(orders.get('BUILT_IN:x')).toBe(1);
  });
});
