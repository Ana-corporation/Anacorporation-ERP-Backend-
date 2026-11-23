import { Injectable } from '@nestjs/common';
import { Prisma, PurchaseOrderStatus, PurchaseOrderType } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { asDate, D, fail, money } from './purchase.util';
import { DashboardQueryDto, PurchaseSettingsDto, SaveApprovalRulesDto } from './dto/purchase.dto';

@Injectable()
export class PurchaseSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(companyId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const row = await this.prisma.purchaseSettings.upsert({
      where: { companyId: company },
      update: {},
      create: { companyId: company },
    });
    return {
      selfApprovalAllowed: row.selfApprovalAllowed,
      overReceiptTolerancePct: D(row.overReceiptTolerancePct).toFixed(4),
      emailMaxAttempts: row.emailMaxAttempts,
      emailRetryIntervalSeconds: row.emailRetryIntervalSeconds,
      emailSubjectTemplate: row.emailSubjectTemplate ?? '',
      emailBodyTemplate: row.emailBodyTemplate ?? '',
      rowVersion: row.rowVersion,
    };
  }

  async saveSettings(companyId: string, dto: PurchaseSettingsDto, actorId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const actor = parseBigIntId(actorId, 'userId');
    const current = await this.prisma.purchaseSettings.findUnique({ where: { companyId: company } });
    if (current && current.rowVersion !== dto.rowVersion) fail('Changed by someone else. Reload?', 'ROW_VERSION_CONFLICT', 409);
    const row = await this.prisma.purchaseSettings.upsert({
      where: { companyId: company },
      create: {
        companyId: company,
        selfApprovalAllowed: dto.selfApprovalAllowed,
        overReceiptTolerancePct: D(dto.overReceiptTolerancePct),
        emailMaxAttempts: dto.emailMaxAttempts,
        emailRetryIntervalSeconds: dto.emailRetryIntervalSeconds,
        emailSubjectTemplate: dto.emailSubjectTemplate,
        emailBodyTemplate: dto.emailBodyTemplate,
        createdBy: actor,
      },
      update: {
        selfApprovalAllowed: dto.selfApprovalAllowed,
        overReceiptTolerancePct: D(dto.overReceiptTolerancePct),
        emailMaxAttempts: dto.emailMaxAttempts,
        emailRetryIntervalSeconds: dto.emailRetryIntervalSeconds,
        emailSubjectTemplate: dto.emailSubjectTemplate,
        emailBodyTemplate: dto.emailBodyTemplate,
        updatedBy: actor,
        updatedAt: new Date(),
        rowVersion: { increment: 1 },
      },
    });
    return {
      selfApprovalAllowed: row.selfApprovalAllowed,
      overReceiptTolerancePct: D(row.overReceiptTolerancePct).toFixed(4),
      emailMaxAttempts: row.emailMaxAttempts,
      emailRetryIntervalSeconds: row.emailRetryIntervalSeconds,
      emailSubjectTemplate: row.emailSubjectTemplate ?? '',
      emailBodyTemplate: row.emailBodyTemplate ?? '',
      rowVersion: row.rowVersion,
    };
  }

  async getRules(companyId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const rules = await this.prisma.purchaseApprovalRule.findMany({
      where: { companyId: company },
      orderBy: [{ poType: 'asc' }, { amountFrom: 'asc' }],
    });
    return {
      rules: rules.map((rule) => ({
        purchaseApprovalRuleId: rule.purchaseApprovalRuleId.toString(),
        poType: rule.poType,
        amountFrom: money(rule.amountFrom),
        amountTo: rule.amountTo == null ? null : money(rule.amountTo),
        currencyId: rule.currencyId.toString(),
        approverRoleId: rule.approverRoleId.toString(),
        isActive: rule.isActive,
        rowVersion: rule.rowVersion,
      })),
    };
  }

  async saveRules(companyId: string, dto: SaveApprovalRulesDto, actorId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const actor = parseBigIntId(actorId, 'userId');
    await this.prisma.$transaction(async (tx) => {
      const keep: bigint[] = [];
      for (const rule of dto.rules) {
        if (rule.amountTo != null && D(rule.amountTo).lessThan(rule.amountFrom)) {
          fail('Amount to cannot be less than amount from', 'PO_AMOUNT_RANGE');
        }
        const data = {
          poType: rule.poType as PurchaseOrderType,
          amountFrom: D(rule.amountFrom),
          amountTo: rule.amountTo == null ? null : D(rule.amountTo),
          currencyId: parseBigIntId(rule.currencyId, 'currencyId'),
          approverRoleId: parseBigIntId(rule.approverRoleId, 'approverRoleId'),
          isActive: rule.isActive,
          updatedBy: actor,
          updatedAt: new Date(),
        };
        if (rule.purchaseApprovalRuleId) {
          const id = parseBigIntId(rule.purchaseApprovalRuleId, 'purchaseApprovalRuleId');
          const current = await tx.purchaseApprovalRule.findFirst({ where: { purchaseApprovalRuleId: id, companyId: company } });
          if (!current) fail('Approval rule was not found', 'PO_RULE_NOT_FOUND', 404);
          if (rule.rowVersion != null && current.rowVersion !== rule.rowVersion) {
            fail('Changed by someone else. Reload?', 'ROW_VERSION_CONFLICT', 409);
          }
          await tx.purchaseApprovalRule.update({
            where: { purchaseApprovalRuleId: id },
            data: { ...data, rowVersion: { increment: 1 } },
          });
          keep.push(id);
        } else {
          const created = await tx.purchaseApprovalRule.create({
            data: { ...data, companyId: company, createdBy: actor },
          });
          keep.push(created.purchaseApprovalRuleId);
        }
      }
      await tx.purchaseApprovalRule.deleteMany({
        where: { companyId: company, ...(keep.length ? { purchaseApprovalRuleId: { notIn: keep } } : {}) },
      });
    });
    return this.getRules(companyId);
  }

  async dashboard(companyId: string, query: DashboardQueryDto) {
    const company = parseBigIntId(companyId, 'companyId');
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const poWhere: Prisma.PurchaseOrderWhereInput = {
      companyId: company,
      ...(query.vendorId ? { vendorId: parseBigIntId(query.vendorId, 'vendorId') } : {}),
      ...(query.warehouseId ? { warehouseId: parseBigIntId(query.warehouseId, 'warehouseId') } : {}),
      ...(query.buyerId ? { buyerId: parseBigIntId(query.buyerId, 'buyerId') } : {}),
      ...(query.poType ? { poType: query.poType as PurchaseOrderType } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            poDate: {
              ...(query.dateFrom ? { gte: asDate(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: asDate(query.dateTo) } : {}),
            },
          }
        : {}),
    };
    const [openRequirements, pendingApproval, approvedNotSent, partiallyReceived, overdueDeliveries, emailFailures, grnsAwaitingQc] = await Promise.all([
      this.prisma.purchaseRequirement.count({
        where: {
          companyId: company,
          status: { in: ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'PARTIALLY_CONVERTED'] },
          ...(query.warehouseId ? { warehouseId: parseBigIntId(query.warehouseId, 'warehouseId') } : {}),
        },
      }),
      this.prisma.purchaseOrder.count({ where: { ...poWhere, status: PurchaseOrderStatus.PENDING_APPROVAL } }),
      this.prisma.purchaseOrder.count({
        where: { ...poWhere, status: PurchaseOrderStatus.APPROVED, sendStatus: { not: 'SENT' } },
      }),
      this.prisma.purchaseOrder.count({ where: { ...poWhere, status: PurchaseOrderStatus.PARTIALLY_RECEIVED } }),
      this.prisma.purchaseOrder.count({
        where: {
          ...poWhere,
          deliveryDate: { lt: today },
          status: { in: [PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.SENT, PurchaseOrderStatus.PARTIALLY_RECEIVED] },
        },
      }),
      this.prisma.purchaseEmailAttempt.count({ where: { companyId: company, status: 'FAILED' } }),
      this.prisma.miQcInspection.count({ where: { companyId: company, status: { in: ['PENDING', 'IN_PROGRESS'] } } }),
    ]);
    return { openRequirements, pendingApproval, approvedNotSent, partiallyReceived, overdueDeliveries, emailFailures, grnsAwaitingQc };
  }
}
