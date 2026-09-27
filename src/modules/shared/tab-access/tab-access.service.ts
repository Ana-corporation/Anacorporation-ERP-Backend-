import { HttpStatus, Injectable } from '@nestjs/common';
import { BusinessException } from '@/common/exceptions/business.exception';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { serialize } from '@/common/utils/bigint.util';
import { CustomFieldEntityType } from '../custom-fields/custom-fields.constants';
import { UpdateTabAccessDto } from './dto/tab-access.dto';
import { TabAccessRepository } from './tab-access.repository';
import {
  getTabDefinition,
  getTabRegistry,
  isSupportedTabEntity,
  normalizeTabKey,
  resolveEntityModuleCode,
  TabRegistryEntry,
} from './tab-registry';

@Injectable()
export class TabAccessService {
  constructor(private readonly repository: TabAccessRepository) {}

  assertSupportedEntity(entityType: string): CustomFieldEntityType {
    if (!isSupportedTabEntity(entityType)) {
      throw new BusinessException(
        `Tab configuration is not supported for entity type: ${entityType}`,
        HttpStatus.BAD_REQUEST,
        [{ field: 'entityType', message: `Unsupported entity type: ${entityType}` }],
        'ENTITY_TYPE_NOT_SUPPORTED',
      );
    }
    return entityType;
  }

  async getEntityTabs(companyId: string, entityType: string) {
    const resolved = this.assertSupportedEntity(entityType);
    const tabs = getTabRegistry(resolved);
    const roles = await this.repository.findCompanyRoles(companyId);
    const accessRows = await this.repository.findAccessRows(companyId, resolved);

    const accessByTabRole = new Map<string, boolean>();
    const configuredTabs = new Set<string>();
    for (const row of accessRows) {
      configuredTabs.add(row.tabKey);
      accessByTabRole.set(`${row.tabKey}:${row.roleId.toString()}`, row.isVisible);
    }

    return serialize({
      entityType: resolved,
      moduleCode: resolveEntityModuleCode(resolved),
      tabs: tabs.map((tab) => ({
        tabKey: tab.tabKey,
        label: tab.label,
        displayOrder: tab.displayOrder,
        isDefaultVisible: tab.isDefaultVisible,
        requiredPermission: tab.requiredPermission ?? null,
        hasOverride: configuredTabs.has(tab.tabKey),
        roles: roles.map((role) => {
          const key = `${tab.tabKey}:${role.roleId.toString()}`;
          const isVisible = accessByTabRole.has(key)
            ? Boolean(accessByTabRole.get(key))
            : tab.isDefaultVisible;
          return {
            roleId: role.roleId.toString(),
            roleCode: role.roleCode,
            roleName: role.roleName,
            isVisible,
          };
        }),
      })),
    });
  }

  async updateTabAccess(
    companyId: string,
    entityType: string,
    tabKey: string,
    dto: UpdateTabAccessDto,
  ) {
    const resolved = this.assertSupportedEntity(entityType);
    const canonicalKey = normalizeTabKey(resolved, tabKey);
    const tab = canonicalKey ? getTabDefinition(resolved, canonicalKey) : undefined;
    if (!tab) {
      throw new BusinessException(
        `Unknown tab key: ${tabKey}`,
        HttpStatus.BAD_REQUEST,
        [{ field: 'tabKey', message: `Tab "${tabKey}" is not in the registry` }],
        'TAB_NOT_FOUND',
      );
    }

    const companyRoles = await this.repository.findCompanyRoles(companyId);
    const allowedIds = new Set(dto.roleIds.map((id) => id.trim()).filter(Boolean));
    const found = await this.repository.findRolesByIds(companyId, [...allowedIds]);
    if (found.length !== allowedIds.size) {
      throw new BusinessException(
        'One or more roleIds are invalid for this company',
        HttpStatus.BAD_REQUEST,
        [{ field: 'roleIds', message: 'All roleIds must belong to this company' }],
        'INVALID_ROLE_IDS',
      );
    }

    // Empty roleIds → isVisible=false for every company role (hide from all).
    // Rows are still written so form-schema does not fall back to isDefaultVisible.
    const roleVisibility = companyRoles.map((role) => ({
      roleId: role.roleId,
      isVisible: allowedIds.has(role.roleId.toString()),
    }));

    await this.repository.replaceTabAccess({
      companyId,
      moduleCode: tab.moduleCode,
      entityType: resolved,
      tabKey: tab.tabKey,
      roleVisibility,
    });

    return this.getEntityTabs(companyId, resolved);
  }

  /**
   * Effective visible tab keys for a user in a company/entity.
   * Hidden tabs must not appear in runtime form-schema.
   * Empty allow-list (all isVisible=false) → tab omitted for everyone.
   * No ADMIN / tenantAdmin silent bypass — Tab Access is independent of CRUD perms.
   */
  async getVisibleTabKeysForUser(params: {
    companyId: string;
    entityType: CustomFieldEntityType;
    user: AuthenticatedUser;
  }): Promise<Set<string>> {
    const { companyId, entityType, user } = params;
    const tabs = getTabRegistry(entityType);
    const primaryRole = await this.repository.findPrimaryUserRole(user.sub, companyId);
    const roleId = primaryRole?.roleId?.toString() ?? null;
    const accessRows = await this.repository.findAccessRows(companyId, entityType);

    const accessByTab = new Map<string, boolean>();
    const configuredTabs = new Set<string>();
    for (const row of accessRows) {
      if (!roleId || row.roleId.toString() !== roleId) continue;
      configuredTabs.add(row.tabKey);
      accessByTab.set(row.tabKey, row.isVisible);
    }

    // Tabs that have ANY company override but no row for this role → hidden
    const tabsWithAnyOverride = new Set(accessRows.map((r) => r.tabKey));

    const visible = new Set<string>();
    for (const tab of tabs) {
      if (!this.userHasRequiredPermission(user, tab)) continue;

      if (configuredTabs.has(tab.tabKey)) {
        if (accessByTab.get(tab.tabKey) === true) visible.add(tab.tabKey);
        continue;
      }

      if (tabsWithAnyOverride.has(tab.tabKey)) {
        // Configured for other roles only → this role is not allowed
        continue;
      }

      if (tab.isDefaultVisible) {
        // No company override yet: default visible
        visible.add(tab.tabKey);
      }
    }

    return visible;
  }

  private userHasRequiredPermission(user: AuthenticatedUser, tab: TabRegistryEntry): boolean {
    const required = tab.requiredPermission?.trim();
    if (!required) return true;
    return user.permissions.includes(required);
  }
}
