import { Injectable, Logger } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { parseBigIntId } from '@/common/utils/bigint.util';
import {
  SystemRoleTemplate,
  resolveCompanySystemTemplates,
} from './system-role-templates';

@Injectable()
export class SystemRoleProvisioningService {
  private readonly logger = new Logger(SystemRoleProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Create missing SYSTEM role rows for a company from the product template registry.
   * Idempotent: skips existing (companyId, roleCode) or (companyId, systemTemplateKey).
   * Never provisions PLATFORM_OWNER into customer companies.
   */
  async provisionForCompany(params: {
    companyId: string;
    moduleCodes?: string[];
    actorId?: string;
  }): Promise<{ created: string[]; skipped: string[] }> {
    const companyIdBig = parseBigIntId(params.companyId);
    const templates = resolveCompanySystemTemplates(params.moduleCodes ?? []);
    const created: string[] = [];
    const skipped: string[] = [];
    const actor = params.actorId ? parseBigIntId(params.actorId) : undefined;

    for (const template of templates) {
      const result = await this.ensureCompanySystemRole(companyIdBig, template, actor);
      if (result === 'created') {
        created.push(template.templateKey);
        await this.auditService.log({
          companyId: params.companyId,
          performedBy: params.actorId,
          action: UserAuditAction.create,
          entityName: 'Role',
          entityId: template.templateKey,
          newValue: {
            action: 'SYSTEM_ROLE_PROVISIONED',
            systemTemplateKey: template.templateKey,
            roleCode: template.defaultRoleCode,
            roleType: 'SYSTEM',
            templateVersion: template.templateVersion,
          },
        });
      } else {
        skipped.push(template.templateKey);
      }
    }

    this.logger.log(
      `System roles for company ${params.companyId}: created=[${created.join(',')}] skipped=[${skipped.join(',')}]`,
    );

    return { created, skipped };
  }

  /**
   * Provision SYSTEM roles using the company's ACTIVE product module entitlements.
   */
  async provisionFromCompanyEntitlements(companyId: string, actorId?: string) {
    const rows = await this.prisma.companyModule.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        isActive: true,
        deletedAt: null,
      },
      include: {
        module: { select: { moduleCode: true, moduleType: true } },
      },
    });

    const moduleCodes = rows
      .filter((r) => r.module?.moduleType === 'product')
      .map((r) => r.module.moduleCode);

    return this.provisionForCompany({ companyId, moduleCodes, actorId });
  }

  /**
   * List company SYSTEM roles linked to a product template (for future migrators).
   * Does not mutate permissions.
   */
  findCompanyRolesByTemplateKey(companyId: string, templateKey: string) {
    return this.prisma.role.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        systemTemplateKey: templateKey,
        roleType: 'SYSTEM',
        deletedAt: null,
      },
      orderBy: { roleId: 'asc' },
    });
  }

  private async ensureCompanySystemRole(
    companyId: bigint,
    template: SystemRoleTemplate,
    createdBy?: bigint,
  ): Promise<'created' | 'skipped'> {
    const existingByKey = await this.prisma.role.findFirst({
      where: {
        companyId,
        systemTemplateKey: template.templateKey,
        deletedAt: null,
      },
    });
    if (existingByKey) return 'skipped';

    const existingByCode = await this.prisma.role.findFirst({
      where: {
        companyId,
        roleCode: template.defaultRoleCode,
        deletedAt: null,
      },
    });

    if (existingByCode) {
      // Backfill template key on legacy SYSTEM row with matching code
      if (!existingByCode.systemTemplateKey) {
        await this.prisma.role.update({
          where: { roleId: existingByCode.roleId },
          data: {
            isSystem: true,
            roleType: 'SYSTEM',
            systemTemplateKey: template.templateKey,
            updatedAt: new Date(),
          },
        });
      }
      return 'skipped';
    }

    await this.prisma.role.create({
      data: {
        companyId,
        roleCode: template.defaultRoleCode,
        roleName: template.defaultRoleName,
        description: template.description,
        isSystem: true,
        roleType: 'SYSTEM',
        systemTemplateKey: template.templateKey,
        status: 'ACTIVE',
        createdBy,
      },
    });

    return 'created';
  }
}
