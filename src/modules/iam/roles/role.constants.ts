/** Stable business error codes for Roles lifecycle (FE i18n). */
export const ROLE_ERROR_CODES = {
  ROLE_HAS_ACTIVE_ASSIGNEES: 'ROLE_HAS_ACTIVE_ASSIGNEES',
  SYSTEM_ROLE_DELETE_BLOCKED: 'SYSTEM_ROLE_DELETE_BLOCKED',
  SYSTEM_ROLE_RENAME_BLOCKED: 'SYSTEM_ROLE_RENAME_BLOCKED',
  SYSTEM_ROLE_PERMISSIONS_LOCKED: 'SYSTEM_ROLE_PERMISSIONS_LOCKED',
  ROLE_INACTIVE: 'ROLE_INACTIVE',
  ROLE_CODE_EXISTS: 'ROLE_CODE_EXISTS',
  DUPLICATE_ASSIGNMENT: 'DUPLICATE_ASSIGNMENT',
} as const;

export type RoleErrorCode = (typeof ROLE_ERROR_CODES)[keyof typeof ROLE_ERROR_CODES];

export function isSystemRole(role: { isSystem?: boolean; roleType?: string | null }): boolean {
  return role.isSystem === true || role.roleType === 'SYSTEM';
}
