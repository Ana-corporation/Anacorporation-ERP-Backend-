import { Injectable } from '@nestjs/common';
import { CompanyAccessContext } from '../interfaces/company-access-context.interface';
import {
  handleDefaultCompanyRole,
  ROLE_LOGIN_HANDLERS,
} from './role-login-response.handlers';
import { AuthRoleSnapshot } from './role-login-response.types';

/**
 * Builds the FE-facing auth snapshot (login + /auth/me) by dispatching
 * to a role-specific callback. Platform nav lives in permissions[];
 * workspace actions live in activeCompany.modules[].permissions.
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

  /** Login body: tokens + role-shaped user/companies/activeCompany (no top-level permissions). */
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
    };
  }

  /** GET /auth/me body: same snapshot + permissions[] (platform nav only when non-empty). */
  toMePayload(snapshot: AuthRoleSnapshot): AuthRoleSnapshot {
    return snapshot;
  }
}
