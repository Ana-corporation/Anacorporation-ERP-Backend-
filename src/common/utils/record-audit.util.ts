export type RecordAuditFields = {
  createdByUserId: string | null;
  createdByName: string | null;
  updatedByUserId: string | null;
  updatedByName: string | null;
  deletedByUserId: string | null;
  deletedByName: string | null;
  approvedByUserId: string | null;
  approvedByName: string | null;
};

const ACTOR_KEYS = ['createdBy', 'updatedBy', 'deletedBy', 'approvedBy'] as const;

function actorId(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

export function collectActorIds(records: Array<Record<string, unknown>>): string[] {
  const ids = new Set<string>();
  for (const record of records) {
    for (const key of ACTOR_KEYS) {
      const id = actorId(record[key]);
      if (id && /^\d+$/.test(id)) ids.add(id);
    }
  }
  return [...ids];
}

export function applyAuditActors<T extends Record<string, unknown>>(
  record: T,
  names: Map<string, string>,
): T & RecordAuditFields {
  const createdByUserId = actorId(record.createdBy);
  const updatedByUserId = actorId(record.updatedBy);
  const deletedByUserId = actorId(record.deletedBy);
  const approvedByUserId = actorId(record.approvedBy);
  return {
    ...record,
    createdByUserId,
    createdByName: createdByUserId ? names.get(createdByUserId) ?? null : null,
    updatedByUserId,
    updatedByName: updatedByUserId ? names.get(updatedByUserId) ?? null : null,
    deletedByUserId,
    deletedByName: deletedByUserId ? names.get(deletedByUserId) ?? null : null,
    approvedByUserId,
    approvedByName: approvedByUserId ? names.get(approvedByUserId) ?? null : null,
  };
}

export function actorDisplayName(user: {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
}): string {
  return (
    user.displayName?.trim() ||
    `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() ||
    user.username?.trim() ||
    ''
  );
}
