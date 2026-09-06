import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ENTITLEMENT_ERROR_CODES } from '@/common/constants/entitlement.constants';
import {
  IS_PUBLIC_KEY,
  MODULE_ENTITLEMENT_KEY,
} from '@/common/constants/metadata.constants';
import { ForbiddenException } from '@/common/exceptions/business.exception';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { checkModuleEntitlement } from '@/common/utils/permission-check.util';

@Injectable()
export class ModuleEntitlementGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const moduleCode = this.reflector.getAllAndOverride<string>(MODULE_ENTITLEMENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!moduleCode) return true;

    const request = context.switchToHttp().getRequest<{ user: AuthenticatedUser }>();
    const user = request.user;
    if (!user) throw new ForbiddenException();

    if (user.role === 'super_admin') return true;

    const result = checkModuleEntitlement(
      {
        modules: user.modules ?? [],
        subscriptionStatus: user.subscriptionStatus ?? 'none',
      },
      moduleCode,
    );

    if (!result.allowed) {
      throw new ForbiddenException(result.message, result.code);
    }

    return true;
  }
}
