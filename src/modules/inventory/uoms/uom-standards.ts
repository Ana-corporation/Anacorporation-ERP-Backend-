/** Standard (system) UoMs seeded per company. Codes uppercase. */

export const UOM_CATEGORIES = ['COUNT', 'LENGTH', 'WEIGHT', 'VOLUME', 'PACKAGING'] as const;
export type UomCategory = (typeof UOM_CATEGORIES)[number];

export type StandardUomDef = {
  code: string;
  name: string;
  category: UomCategory;
  decimalPlaces: number;
};

export const STANDARD_UOMS: StandardUomDef[] = [
  { code: 'NOS', name: 'Numbers', category: 'COUNT', decimalPlaces: 0 },
  { code: 'SET', name: 'Set', category: 'COUNT', decimalPlaces: 0 },
  { code: 'PAIR', name: 'Pair', category: 'COUNT', decimalPlaces: 0 },
  { code: 'BOX', name: 'Box', category: 'PACKAGING', decimalPlaces: 0 },
  { code: 'PACK', name: 'Pack', category: 'PACKAGING', decimalPlaces: 0 },
  { code: 'ROLL', name: 'Roll', category: 'PACKAGING', decimalPlaces: 0 },
  { code: 'DRUM', name: 'Drum', category: 'PACKAGING', decimalPlaces: 0 },
  { code: 'BAG', name: 'Bag', category: 'PACKAGING', decimalPlaces: 0 },
  { code: 'MTR', name: 'Meter', category: 'LENGTH', decimalPlaces: 3 },
  { code: 'CM', name: 'Centimeter', category: 'LENGTH', decimalPlaces: 3 },
  { code: 'MM', name: 'Millimeter', category: 'LENGTH', decimalPlaces: 3 },
  { code: 'FT', name: 'Foot', category: 'LENGTH', decimalPlaces: 3 },
  { code: 'KG', name: 'Kilogram', category: 'WEIGHT', decimalPlaces: 3 },
  { code: 'GM', name: 'Gram', category: 'WEIGHT', decimalPlaces: 3 },
  { code: 'TON', name: 'Ton', category: 'WEIGHT', decimalPlaces: 3 },
  { code: 'LTR', name: 'Litre', category: 'VOLUME', decimalPlaces: 3 },
  { code: 'ML', name: 'Millilitre', category: 'VOLUME', decimalPlaces: 3 },
];

export const STANDARD_UOM_BY_CODE = new Map(STANDARD_UOMS.map((u) => [u.code, u]));
