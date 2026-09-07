import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  IS_PUBLIC_KEY,
  MODULE_PERMISSION_KEY,
} from '@/common/constants/metadata.constants';
import { ModulePermissionRequirement } from '@/common/decorators/auth.decorators';
import { ForbiddenException } from '@/common/exceptions/business.exception';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { checkPermission, explainPermissionDenial } from '@/common/utils/permission-check.util';

@Injectable()
export class ModulePermissionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const requirement = this.reflector.getAllAndOverride<ModulePermissionRequirement>(
      MODULE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requirement) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user: AuthenticatedUser }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException();
    }

    if (user.role === 'super_admin') {
      return true;
    }

    const ctx = {
      modules: user.modules ?? [],
      subscriptionStatus: user.subscriptionStatus ?? 'none',
    };

    const allowed = checkPermission(ctx, requirement.moduleCode, requirement.action);

    if (!allowed) {
      const denial = explainPermissionDenial(ctx, requirement.moduleCode, requirement.action);
      throw new ForbiddenException(denial.message, denial.code);
    }

    return true;
  }
}
