import { ForbiddenException } from '@/common/exceptions/business.exception';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';

/**
 * Reject when a tenant user targets another company in the URL.
 * Platform / super-admin often has no companyId — those requests stay allowed
 * and remain scoped by the path companyId in the repository.
 */
export function assertCompanyAccess(pathCompanyId: string, user: AuthenticatedUser) {
  if (user.companyId && pathCompanyId !== user.companyId) {
    throw new ForbiddenException('Company context mismatch');
  }
}
