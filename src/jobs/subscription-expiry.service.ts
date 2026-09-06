import { Injectable, Logger } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { UserContextCacheService } from '@/modules/iam/authentication/user-context-cache.service';
import { EntitlementRepository } from '@/modules/subscription/entitlements/entitlement.repository';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

/**
 * Marks live subscriptions past endDate as EXPIRED and invalidates tenant caches.
 * Wire to BullMQ/cron when job runner is available.
 */
@Injectable()
export class SubscriptionExpiryService {
  private readonly logger = new Logger(SubscriptionExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlementRepository: EntitlementRepository,
    private readonly auditService: AuditService,
    private readonly userContextCache: UserContextCacheService,
  ) {}

  async run(asOf = new Date()) {
    const expired = await this.entitlementRepository.findExpiredLiveSubscriptions(asOf);
    this.logger.log(`Subscription expiry: ${expired.length} subscription(s) to process`);

    for (const row of expired) {
      await this.prisma.companySubscription.update({
        where: { companySubscriptionId: row.companySubscriptionId },
        data: { status: 'expired', updatedAt: new Date() },
      });

      const companyId = row.companyId.toString();
      await this.auditService.log({
        companyId,
        action: UserAuditAction.update,
        entityName: 'CompanySubscription',
        entityId: row.companySubscriptionId.toString(),
        newValue: { status: 'expired', reason: 'endDate passed' },
      });

      await this.userContextCache.invalidateCompany(companyId);
    }

    return { processed: expired.length };
  }
}
