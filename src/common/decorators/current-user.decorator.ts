import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser, TenantContext } from '../interfaces/auth.interface';
import { ForbiddenException } from '../exceptions/business.exception';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>();
    return request.user;
  },
);

function resolveCompanyId(ctx: ExecutionContext): string {
  const request = ctx.switchToHttp().getRequest<{
    user?: AuthenticatedUser;
    tenant?: TenantContext;
  }>();

  if (request.tenant?.companyId) {
    return request.tenant.companyId;
  }
  if (request.user?.companyId) {
    return request.user.companyId;
  }
  throw new ForbiddenException('Company context required');
}

export const CompanyId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => resolveCompanyId(ctx),
);

/** Prefer tenant context set by TenantGuard (same value as CompanyId). */
export const TenantCompanyId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => resolveCompanyId(ctx),
);

/** @deprecated Use CompanyId */
export const OrganizationId = CompanyId;
