import { SYSTEM_ROLE_TEMPLATES } from './system-role-templates';

/** Max length matches prisma roles.role_code VarChar(40). */
export const ROLE_CODE_MAX_LENGTH = 40;

/** Reserved system role codes — CUSTOM roles cannot use these. */
export const RESERVED_ROLE_CODES = new Set(
  SYSTEM_ROLE_TEMPLATES.map((t) => t.defaultRoleCode.toUpperCase()),
);

/**
 * Normalize a human label or client-supplied code into UPPER_SNAKE.
 * Empty / unusable input → "ROLE".
 */
export function normalizeRoleCodeBase(raw: string): string {
  const normalized = String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  if (!normalized) return 'ROLE';
  return normalized.slice(0, ROLE_CODE_MAX_LENGTH);
}

export function isReservedRoleCode(code: string): boolean {
  return RESERVED_ROLE_CODES.has(code.trim().toUpperCase());
}

/**
 * Build a unique roleCode within a company.
 * Preferred (explicit or from name) + _2, _3… until free.
 */
export async function allocateUniqueRoleCode(params: {
  preferredBase: string;
  isTaken: (code: string) => Promise<boolean>;
}): Promise<string> {
  const base = normalizeRoleCodeBase(params.preferredBase);
  let candidate = base;
  let n = 1;

  while (await params.isTaken(candidate)) {
    n += 1;
    const suffix = `_${n}`;
    const maxBase = ROLE_CODE_MAX_LENGTH - suffix.length;
    candidate = `${base.slice(0, Math.max(1, maxBase))}${suffix}`;
  }

  return candidate;
}
