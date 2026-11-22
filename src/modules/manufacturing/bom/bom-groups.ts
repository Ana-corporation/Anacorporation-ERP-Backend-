/** Ordering helpers shared by the detail view, validation and requirements. */

export interface GroupableLine {
  bomLineId: bigint;
  lineType: 'MAIN' | 'SUB';
  commonKey: string;
  parentLineId: bigint | null;
  lineNumber: number;
}

export interface LineGroup<T extends GroupableLine> {
  commonKey: string;
  main: T | null;
  subLines: T[];
}

/** Numeric keys sort numerically (2 before 10); text keys after, alphabetically. */
export function compareCommonKeys(a: string, b: string): number {
  const na = /^\d+$/.test(a) ? Number(a) : NaN;
  const nb = /^\d+$/.test(b) ? Number(b) : NaN;
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  if (!Number.isNaN(na)) return -1;
  if (!Number.isNaN(nb)) return 1;
  return a.localeCompare(b);
}

/**
 * MAIN with its SUB lines, ordered by Common Key then line number. Ownership comes from
 * parentLineId (the key is only for grouping); a SUB whose parent is missing gets a group with
 * main = null so validation can report it.
 */
export function buildGroups<T extends GroupableLine>(lines: T[]): LineGroup<T>[] {
  const mains = lines.filter((l) => l.lineType === 'MAIN');
  const byMainId = new Map<string, LineGroup<T>>();
  for (const main of mains) byMainId.set(main.bomLineId.toString(), { commonKey: main.commonKey, main, subLines: [] });
  const orphans = new Map<string, LineGroup<T>>();
  for (const line of lines) {
    if (line.lineType !== 'SUB') continue;
    const group = line.parentLineId !== null ? byMainId.get(line.parentLineId.toString()) : undefined;
    if (group) {
      group.subLines.push(line);
    } else {
      const key = `orphan:${line.commonKey}`;
      const g = orphans.get(key) ?? { commonKey: line.commonKey, main: null, subLines: [] };
      g.subLines.push(line);
      orphans.set(key, g);
    }
  }
  const groups = [...byMainId.values(), ...orphans.values()];
  for (const g of groups) g.subLines.sort((a, b) => a.lineNumber - b.lineNumber);
  return groups.sort(
    (a, b) => compareCommonKeys(a.commonKey, b.commonKey) || (a.main?.lineNumber ?? 0) - (b.main?.lineNumber ?? 0),
  );
}
