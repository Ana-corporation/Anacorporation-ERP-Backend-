import { SetMetadata } from '@nestjs/common';
import {
  ALLOW_MUST_CHANGE_PASSWORD_KEY,
  IS_PUBLIC_KEY,
  MODULE_PERMISSION_KEY,
  PERMISSIONS_KEY,
  TENANT_OPTIONAL_KEY,
} from '../constants/metadata.constants';
import { PermissionCode } from '../constants/permissions.constant';
import { Phase1PermissionAction } from '../constants/modules.constant';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const RequirePermissions = (...permissions: PermissionCode[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export interface ModulePermissionRequirement {
  moduleCode: string;
  action: Phase1PermissionAction;
}

export const RequireModulePermission = (moduleCode: string, action: Phase1PermissionAction) =>
  SetMetadata(MODULE_PERMISSION_KEY, { moduleCode, action } satisfies ModulePermissionRequirement);

export const TenantOptional = () => SetMetadata(TENANT_OPTIONAL_KEY, true);

/** Mark endpoints usable while user must change temp password (e.g. change-password). */
export const AllowWhenMustChangePassword = () =>
  SetMetadata(ALLOW_MUST_CHANGE_PASSWORD_KEY, true);
