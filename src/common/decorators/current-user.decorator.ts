import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../interfaces/auth.interface';
import { ForbiddenException } from '../exceptions/business.exception';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>();
    return request.user;
  },
);

export const CompanyId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>();
    if (!request.user?.companyId) {
      throw new ForbiddenException('Company context required');
    }
    return request.user.companyId;
  },
);

/** @deprecated Use CompanyId */
export const OrganizationId = CompanyId;
