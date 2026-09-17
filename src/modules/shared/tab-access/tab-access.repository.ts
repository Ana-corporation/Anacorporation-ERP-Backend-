import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { CustomFieldEntityType } from '../custom-fields/custom-fields.constants';

@Injectable()
export class TabAccessRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAccessRows(companyId: string, entityType: CustomFieldEntityType, tabKey?: string) {
    return this.prisma.companyTabAccess.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        entityType,
        ...(tabKey ? { tabKey } : {}),
      },
    });
  }

  findCompanyRoles(companyId: string) {
    return this.prisma.role.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        status: 'ACTIVE',
      },
      select: {
        roleId: true,
        roleCode: true,
        roleName: true,
        systemTemplateKey: true,
      },
      orderBy: [{ roleCode: 'asc' }, { roleId: 'asc' }],
    });
  }

  findRolesByIds(companyId: string, roleIds: string[]) {
    if (roleIds.length === 0) return Promise.resolve([]);
    return this.prisma.role.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        roleId: { in: roleIds.map((id) => parseBigIntId(id)) },
      },
      select: { roleId: true, roleCode: true, roleName: true },
    });
  }

  findPrimaryUserRole(userId: string, companyId: string) {
    return this.prisma.userRole.findMany({
      where: {
        userId: parseBigIntId(userId),
        companyId: parseBigIntId(companyId),
        isActive: true,
        endedAt: null,
      },
      include: { role: true },
      orderBy: { roleId: 'asc' },
    }).then((roles) => {
      if (roles.length === 0) return null;
      const admin =
        roles.find(
          (ur) =>
            ur.role.roleCode === 'ADMIN' || ur.role.systemTemplateKey === 'ADMIN',
        ) ?? null;
      return admin ?? roles[0];
    });
  }

  async replaceTabAccess(params: {
    companyId: string;
    moduleCode: string;
    entityType: CustomFieldEntityType;
    tabKey: string;
    roleVisibility: Array<{ roleId: bigint; isVisible: boolean }>;
  }) {
    const companyId = parseBigIntId(params.companyId);
    await this.prisma.$transaction(async (tx) => {
      await tx.companyTabAccess.deleteMany({
        where: {
          companyId,
          entityType: params.entityType,
          tabKey: params.tabKey,
        },
      });
      if (params.roleVisibility.length === 0) return;
      await tx.companyTabAccess.createMany({
        data: params.roleVisibility.map((row) => ({
          companyId,
          moduleCode: params.moduleCode,
          entityType: params.entityType,
          tabKey: params.tabKey,
          roleId: row.roleId,
          isVisible: row.isVisible,
        })),
      });
    });
  }
}
