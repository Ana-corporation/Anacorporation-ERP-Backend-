import { Injectable } from '@nestjs/common';
import { CompanySecurityPolicy } from '@prisma/client';
import { AuthRepository } from './auth.repository';
import { ForbiddenException } from '@/common/exceptions/business.exception';

export interface SecurityPolicySnapshot {
  maxLoginAttempts: number;
  lockoutDurationMin: number;
  sessionTimeoutMin: number;
  allowMultipleLogins: boolean;
  maxConcurrentSessions: number | null;
}

const DEFAULT_POLICY: SecurityPolicySnapshot = {
  maxLoginAttempts: 5,
  lockoutDurationMin: 30,
  sessionTimeoutMin: 60,
  allowMultipleLogins: true,
  maxConcurrentSessions: null,
};

@Injectable()
export class CompanySecurityPolicyService {
  constructor(private readonly authRepository: AuthRepository) {}

  async getPolicyForCompany(companyId: string): Promise<SecurityPolicySnapshot> {
    const policy = await this.authRepository.findSecurityPolicy(companyId);
    return policy ? this.toSnapshot(policy) : DEFAULT_POLICY;
  }

  async assertLoginAllowed(userId: string) {
    const auth = await this.authRepository.findAuthentication(userId);
    if (!auth) return;

    if (auth.accountLockedUntil && auth.accountLockedUntil > new Date()) {
      throw new ForbiddenException(
        `Account is locked until ${auth.accountLockedUntil.toISOString()}`,
      );
    }

    if (auth.accountLockedUntil && auth.accountLockedUntil <= new Date()) {
      await this.authRepository.clearAccountLock(userId);
    }
  }

  async recordFailedLogin(userId: string, companyId: string) {
    const policy = await this.getPolicyForCompany(companyId);
    const auth = await this.authRepository.incrementFailedLogin(userId);

    if (auth.failedLoginCount >= policy.maxLoginAttempts) {
      const lockedUntil = new Date(Date.now() + policy.lockoutDurationMin * 60 * 1000);
      await this.authRepository.lockAccount(
        userId,
        lockedUntil,
        `Exceeded ${policy.maxLoginAttempts} failed login attempts`,
      );
    }
  }

  async ensureDefaultPolicy(companyId: string, createdBy?: string) {
    await this.authRepository.ensureDefaultSecurityPolicy(companyId, createdBy);
  }

  private toSnapshot(policy: CompanySecurityPolicy): SecurityPolicySnapshot {
    return {
      maxLoginAttempts: policy.maxLoginAttempts,
      lockoutDurationMin: policy.lockoutDurationMin,
      sessionTimeoutMin: policy.sessionTimeoutMin,
      allowMultipleLogins: policy.allowMultipleLogins,
      maxConcurrentSessions: policy.maxConcurrentSessions,
    };
  }
}
