import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, TENANT_OPTIONAL_KEY } from '@/common/constants/metadata.constants';
import { ForbiddenException } from '@/common/exceptions/business.exception';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const tenantOptional = this.reflector.getAllAndOverride<boolean>(TENANT_OPTIONAL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (tenantOptional) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user: AuthenticatedUser }>();
    const user = request.user;

    if (!user?.companyId) {
      if (user?.role === 'super_admin') {
        return true;
      }
      throw new ForbiddenException('Company context required');
    }

    return true;
  }
}
