/** Item Master auto code: ITM-000001, ITM-000002, … */

export const ITEM_CODE_PREFIX_DEFAULT = 'ITM';
export const ITEM_CODE_SEQ_WIDTH = 6;

const AUTO_CODE_RE = /^([A-Z0-9]+)-(\d+)$/;

export function formatItemCode(prefix: string, sequence: number): string {
  const p = prefix.trim().toUpperCase() || ITEM_CODE_PREFIX_DEFAULT;
  if (sequence < 1) {
    throw new Error(`Item sequence out of range: ${sequence}`);
  }
  return `${p}-${String(sequence).padStart(ITEM_CODE_SEQ_WIDTH, '0')}`;
}

export function parseItemAutoSequence(itemCode: string, prefix: string): number | null {
  const m = itemCode.trim().toUpperCase().match(AUTO_CODE_RE);
  if (!m) return null;
  const expected = prefix.trim().toUpperCase() || ITEM_CODE_PREFIX_DEFAULT;
  if (m[1] !== expected) return null;
  return Number(m[2]);
}
