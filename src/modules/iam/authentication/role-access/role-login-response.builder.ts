import { Injectable } from '@nestjs/common';
import { CompanyAccessContext } from '../interfaces/company-access-context.interface';
import {
  handleDefaultCompanyRole,
  ROLE_LOGIN_HANDLERS,
} from './role-login-response.handlers';
import { AuthRoleSnapshot } from './role-login-response.types';

/**
 * Builds the FE-facing auth snapshot (login + /auth/me) by dispatching
 * to a role-specific callback (Option C Hybrid):
 *   - PLATFORM_OWNER → permissions[] = platform nav codes
 *   - Company roles  → permissions[] = tenant role codes (no platform nav)
 * Workspace product actions also live in activeCompany.modules[].permissions.
 * API guards remain the final authorization layer (DB/user-context).
 */
@Injectable()
export class RoleLoginResponseBuilder {
  build(params: {
    accessContext: CompanyAccessContext;
    rolePermissions: string[];
  }): AuthRoleSnapshot {
    const roleCode = params.accessContext.activeCompany.role?.roleCode?.toUpperCase();
    const handler =
      (roleCode && ROLE_LOGIN_HANDLERS[roleCode]) || handleDefaultCompanyRole;

    return handler({
      accessContext: params.accessContext,
      rolePermissions: params.rolePermissions,
    });
  }

  /** Login body: tokens + role-shaped snapshot including permissions contract. */
  toLoginPayload(
    snapshot: AuthRoleSnapshot,
    tokens: {
      accessToken: string;
      refreshToken: string;
      expiresIn: string;
      tokenType?: string;
      requiresCompanySelection?: boolean;
    },
  ) {
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      tokenType: tokens.tokenType ?? 'Bearer',
      requiresCompanySelection: tokens.requiresCompanySelection ?? false,
      user: snapshot.user,
      companies: snapshot.companies,
      activeCompany: snapshot.activeCompany,
      permissions: snapshot.permissions,
      tenantAdmin: snapshot.tenantAdmin,
      platformOwner: snapshot.platformOwner,
    };
  }

  /** GET /auth/me body: full Option C snapshot. */
  toMePayload(snapshot: AuthRoleSnapshot): AuthRoleSnapshot {
    return snapshot;
  }
}
