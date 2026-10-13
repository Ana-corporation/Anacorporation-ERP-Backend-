import { WarehouseLocationType } from '@prisma/client';

/** company_code_sequences.scope for Inventory Location codes */
export const LOCATION_CODE_SCOPE = 'WAREHOUSE';

/** Store category (locationType) → code prefix. Legacy "Store" numbers with General Store. */
export const LOCATION_CODE_PREFIX: Record<WarehouseLocationType, string> = {
  RawMaterialStore: 'RMS',
  SparesStore: 'SPR',
  FinishedGoodsStore: 'FGS',
  BoughtOutStore: 'BOS',
  ElectricalStore: 'ELS',
  GeneralStore: 'GEN',
  OilStore: 'OIL',
  Store: 'GEN',
  Warehouse: 'WHS',
  Godown: 'GDN',
  Other: 'OTH',
};

/** RMS + 1 → RMS-001; grows past 999 (RMS-1000). */
export function formatLocationCode(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(3, '0')}`;
}
