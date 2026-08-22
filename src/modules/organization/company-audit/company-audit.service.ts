import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { CompanyAuditRepository } from './company-audit.repository';

type AuditRow = Awaited<
  ReturnType<CompanyAuditRepository['findManyByCompany']>
>['items'][number];

@Injectable()
export class CompanyAuditService {
  constructor(private readonly repository: CompanyAuditRepository) {}

  async findAll(
    companyId: string,
    query: PaginationQueryDto & { from?: string; to?: string },
  ) {
    const { items, total, page, limit } = await this.repository.findManyByCompany(
      companyId,
      query,
    );
    return serialize(
      toPaginatedResult(
        items.map((row) => this.toPlatformAuditRow(row)),
        total,
        page,
        limit,
      ),
    );
  }

  private displayName(user: {
    displayName: string | null;
    firstName: string | null;
    lastName: string | null;
    username: string;
    email: string;
  } | null): string {
    if (!user) return 'System';
    return (
      user.displayName?.trim() ||
      [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
      user.username ||
      user.email
    );
  }

  private toPlatformAuditRow(row: AuditRow) {
    const mapped = this.mapLifecycle(row);
    const actorUser = row.performer ?? row.user;

    return {
      auditId: row.auditId.toString(),
      occurredAt: row.performedAt.toISOString(),
      action: mapped.action,
      actor: {
        userId: actorUser?.userId?.toString() ?? row.performedBy?.toString() ?? null,
        displayName: this.displayName(actorUser),
        email: actorUser?.email ?? null,
      },
      target: mapped.target,
      details: mapped.details,
      // Raw fields kept for debugging / future FE use
      entityName: row.entityName,
      entityId: row.entityId?.toString() ?? null,
      rawAction: row.action,
    };
  }

  private mapLifecycle(row: AuditRow): {
    action: string;
    target: { type: string; id: string | null; label: string };
    details: string;
  } {
    const entity = row.entityName;
    const newValue = (row.newValue ?? {}) as Record<string, unknown>;
    const status = String(newValue.status ?? '').toLowerCase();
    const entityId = row.entityId?.toString() ?? null;

    if (entity === 'Company') {
      if (row.action === UserAuditAction.create) {
        return {
          action: 'COMPANY_CREATED',
          target: { type: 'company', id: entityId, label: String(newValue.name ?? 'Company') },
          details: `Company created${newValue.companyCode ? ` (${newValue.companyCode})` : ''}`,
        };
      }
      if (status === 'suspended') {
        return {
          action: 'COMPANY_SUSPENDED',
          target: { type: 'company', id: entityId, label: 'Company' },
          details: 'Company suspended',
        };
      }
      if (status === 'active') {
        return {
          action: 'COMPANY_ACTIVATED',
          target: { type: 'company', id: entityId, label: 'Company' },
          details: 'Company activated',
        };
      }
      if (status === 'trial') {
        return {
          action: 'COMPANY_SET_TRIAL',
          target: { type: 'company', id: entityId, label: 'Company' },
          details: 'Company set to trial',
        };
      }
      if (status === 'cancelled') {
        return {
          action: 'COMPANY_CANCELLED',
          target: { type: 'company', id: entityId, label: 'Company' },
          details: 'Company cancelled',
        };
      }
      return {
        action: 'COMPANY_UPDATED',
        target: { type: 'company', id: entityId, label: 'Company' },
        details: 'Company updated',
      };
    }

    if (entity === 'CompanySubscription') {
      if (row.action === UserAuditAction.create) {
        return {
          action: 'PLAN_ASSIGNED',
          target: {
            type: 'subscription',
            id: entityId,
            label: String(newValue.planId ?? 'Subscription'),
          },
          details: `Subscription assigned (status: ${newValue.status ?? 'pending'})`,
        };
      }
      if (status === 'cancelled' || row.action === UserAuditAction.delete) {
        return {
          action: 'SUBSCRIPTION_CHANGED',
          target: { type: 'subscription', id: entityId, label: 'Subscription' },
          details: 'Subscription cancelled',
        };
      }
      return {
        action: 'SUBSCRIPTION_CHANGED',
        target: { type: 'subscription', id: entityId, label: 'Subscription' },
        details: `Subscription updated${status ? ` → ${status}` : ''}`,
      };
    }

    if (entity === 'CompanyModule') {
      const isActive = newValue.isActive;
      if (isActive === false) {
        return {
          action: 'MODULE_DISABLED',
          target: {
            type: 'module',
            id: entityId,
            label: String(newValue.moduleId ?? 'Module'),
          },
          details: 'Module disabled',
        };
      }
      if (isActive === true || row.action === UserAuditAction.create) {
        return {
          action: 'MODULE_ENABLED',
          target: {
            type: 'module',
            id: entityId,
            label: String(newValue.moduleId ?? 'Module'),
          },
          details: 'Module enabled',
        };
      }
      return {
        action: 'MODULE_UPDATED',
        target: {
          type: 'module',
          id: entityId,
          label: String(newValue.moduleId ?? 'Module'),
        },
        details: 'Module updated',
      };
    }

    if (entity === 'UserInvite' || (entity === 'User' && row.action === UserAuditAction.invite)) {
      return {
        action: 'ADMIN_INVITED',
        target: {
          type: 'user',
          id: entityId,
          label: String(newValue.email ?? 'User'),
        },
        details: `User invited${newValue.email ? `: ${newValue.email}` : ''}`,
      };
    }

    return {
      action: String(row.action).toUpperCase(),
      target: {
        type: entity.toLowerCase(),
        id: entityId,
        label: entity,
      },
      details: `${entity} ${row.action}`,
    };
  }
}
