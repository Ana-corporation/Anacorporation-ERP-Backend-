import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY, TENANT_OPTIONAL_KEY } from '../constants/metadata.constants';
import { PermissionCode } from '../constants/permissions.constant';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const RequirePermissions = (...permissions: PermissionCode[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const TenantOptional = () => SetMetadata(TENANT_OPTIONAL_KEY, true);
