export type FieldOrderSource = 'BUILT_IN' | 'CUSTOM';

export const fieldOrderKey = (source: FieldOrderSource, fieldKey: string) => `${source}:${fieldKey}`;

export const customFieldSectionKey = (def: { sectionKey: string | null }) => def.sectionKey ?? 'custom';

export interface FieldOrderInputs {
  /** Registry order = system default order. */
  builtIns: ReadonlyArray<{ fieldKey: string; sectionKey: string }>;
  customs: ReadonlyArray<{ fieldName: string; sectionKey: string | null; sortOrder: number }>;
  savedBuiltInOrder: ReadonlyMap<string, number>;
}

type Entry = {
  id: string;
  isCustom: boolean;
  saved: number | null;
  rank: number;
  name: string;
};

/**
 * Effective 1..n position of every field inside its section, keyed by `fieldOrderKey`.
 *
 * A section is "saved" once any built-in in it has a display_order: built-in display_order and
 * custom sort_order then share one number space, and built-ins without a position (added in a
 * later release) go last in registry order. Otherwise the system default applies: built-ins in
 * registry order, then custom fields by sort_order.
 */
export function computeDisplayOrders(inputs: FieldOrderInputs): Map<string, number> {
  const sections = new Map<string, Entry[]>();
  const push = (sectionKey: string, entry: Entry) => {
    const list = sections.get(sectionKey) ?? [];
    list.push(entry);
    sections.set(sectionKey, list);
  };

  inputs.builtIns.forEach((field, index) =>
    push(field.sectionKey, {
      id: fieldOrderKey('BUILT_IN', field.fieldKey),
      isCustom: false,
      saved: inputs.savedBuiltInOrder.get(field.fieldKey) ?? null,
      rank: index,
      name: field.fieldKey,
    }),
  );
  for (const def of inputs.customs) {
    push(customFieldSectionKey(def), {
      id: fieldOrderKey('CUSTOM', def.fieldName),
      isCustom: true,
      saved: def.sortOrder,
      rank: Number.MAX_SAFE_INTEGER,
      name: def.fieldName,
    });
  }

  const orders = new Map<string, number>();
  for (const entries of sections.values()) {
    const hasSaved = entries.some((e) => !e.isCustom && e.saved !== null);
    const sorted = hasSaved ? sortSaved(entries) : sortDefault(entries);
    sorted.forEach((entry, index) => orders.set(entry.id, index + 1));
  }
  return orders;
}

function sortSaved(entries: Entry[]): Entry[] {
  const placed = entries
    .filter((e) => e.saved !== null)
    .sort(
      (a, b) =>
        a.saved! - b.saved! ||
        Number(a.isCustom) - Number(b.isCustom) ||
        a.name.localeCompare(b.name),
    );
  const unplaced = entries.filter((e) => e.saved === null).sort((a, b) => a.rank - b.rank);
  return [...placed, ...unplaced];
}

function sortDefault(entries: Entry[]): Entry[] {
  const builtIns = entries.filter((e) => !e.isCustom).sort((a, b) => a.rank - b.rank);
  const customs = entries
    .filter((e) => e.isCustom)
    .sort((a, b) => a.saved! - b.saved! || a.name.localeCompare(b.name));
  return [...builtIns, ...customs];
}
