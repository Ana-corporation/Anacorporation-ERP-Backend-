import { ForbiddenException } from '@/common/exceptions/business.exception';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';

/**
 * Reject when a tenant user targets another company in the URL.
 * Platform owners (platform_companies:*) and users without companyId may
 * cross tenants; path companyId still scopes repository queries.
 */
export function assertCompanyAccess(pathCompanyId: string, user: AuthenticatedUser) {
  if (
    user.role === 'super_admin' ||
    user.role === 'PLATFORM_OWNER' ||
    user.permissions?.includes('platform_companies:view') ||
    user.permissions?.includes('platform_companies:edit') ||
    user.permissions?.includes('companies:view') ||
    user.permissions?.includes('companies:edit')
  ) {
    return;
  }

  if (user.companyId && pathCompanyId !== user.companyId) {
    throw new ForbiddenException('Company context mismatch');
  }
}
