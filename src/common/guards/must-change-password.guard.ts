import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ALLOW_MUST_CHANGE_PASSWORD_KEY,
  IS_PUBLIC_KEY,
} from '@/common/constants/metadata.constants';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';

/**
 * While mustChangePassword=true, only allow auth bootstrap routes
 * (me / change-password / logout / companies list) plus Public routes.
 */
@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const allow = this.reflector.getAllAndOverride<boolean>(ALLOW_MUST_CHANGE_PASSWORD_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allow) return true;

    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
      method?: string;
      path?: string;
      url?: string;
      route?: { path?: string };
    }>();

    const user = request.user;
    if (!user || user.role === 'super_admin' || !user.mustChangePassword) {
      return true;
    }

    const path = (request.path || request.url || '').split('?')[0].toLowerCase();
    if (this.isAllowedPath(path, request.method ?? 'GET')) {
      return true;
    }

    throw new ForbiddenException({
      message: 'Password change required',
      code: 'MUST_CHANGE_PASSWORD',
      statusCode: 403,
    });
  }

  private isAllowedPath(path: string, method: string): boolean {
    const m = method.toUpperCase();
    // Match with or without /api/v1 prefix
    const normalized = path.replace(/^\/api\/v\d+/, '') || path;

    const allowedExact = new Set([
      '/auth/me',
      '/auth/logout',
      '/auth/change-password',
      '/auth/companies',
      '/auth/refresh',
    ]);

    if (allowedExact.has(normalized)) return true;

    // switch-company still issues new tokens — allow so multi-company invitees can switch
    if (normalized === '/auth/switch-company' && m === 'POST') return true;

    return false;
  }
}
