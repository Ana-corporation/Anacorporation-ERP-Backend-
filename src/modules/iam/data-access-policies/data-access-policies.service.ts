import { HttpStatus, Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import {
  BusinessException,
  ConflictException,
  NotFoundException,
} from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { UserContextCacheService } from '@/modules/iam/authentication/user-context-cache.service';
import {
  AssignUserDataAccessPolicyDto,
  CreateDataAccessPolicyDto,
  SetUserDataAccessPoliciesDto,
  UpdateDataAccessPolicyDto,
} from './dto/data-access-policy.dto';
import { DataAccessPoliciesRepository } from './data-access-policies.repository';

export type UserDataAccessScope = {
  /** True when user has ≥1 active, non-deleted policy assignment. */
  isRestricted: boolean;
  branchIds: string[];
  departmentIds: string[];
  warehouseIds: string[];
};

type PolicyWithScopes = {
  policyId: bigint;
  companyId: bigint;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date | null;
  deletedAt: Date | null;
  branches: Array<{ branchId: bigint }>;
  departments: Array<{ departmentId: bigint }>;
  warehouses: Array<{ warehouseId: bigint }>;
  [key: string]: unknown;
};

@Injectable()
export class DataAccessPoliciesService {
  constructor(
    private readonly repository: DataAccessPoliciesRepository,
    private readonly auditService: AuditService,
    private readonly userContextCache: UserContextCacheService,
  ) {}

  async findAll(companyId: string, query: PaginationQueryDto) {
    const { items, total, page, limit } = await this.repository.findManyByCompany(
      companyId,
      query,
    );
    return serialize(
      toPaginatedResult(
        items.map((item) => this.toPolicyResponse(item as PolicyWithScopes)),
        total,
        page,
        limit,
      ),
    );
  }

  async findOne(id: string, companyId: string) {
    const policy = await this.repository.findById(id, companyId);
    if (!policy) throw new NotFoundException('Data access policy');
    return serialize(this.toPolicyResponse(policy as PolicyWithScopes));
  }

  async create(companyId: string, dto: CreateDataAccessPolicyDto, actorId: string) {
    const scopes = this.normalizeScopeIds(dto);
    await this.assertScopeIdsBelongToCompany(companyId, scopes);

    const requestedCode = dto.code.trim().toUpperCase();
    let code = await this.resolveUniqueCode(companyId, requestedCode);
    let policy: { policyId: bigint } | undefined;

    // Race-safe: DB unique(companyId, code) may still collide between check and insert.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        policy = await this.repository.create(companyId, { ...dto, code }, actorId);
        break;
      } catch (error) {
        if (!this.isUniqueConstraintError(error) || attempt === 4) {
          throw error;
        }
        // Re-resolve from original requested base so we get _2, _3, ... not nested suffixes.
        code = await this.resolveUniqueCode(companyId, requestedCode);
      }
    }

    if (!policy) {
      throw new ConflictException('Unable to allocate unique policy code');
    }

    await this.repository.replacePolicyScopes(policy.policyId.toString(), scopes);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'DataAccessPolicy',
      entityId: policy.policyId.toString(),
      newValue: { ...dto, code } as unknown as Record<string, unknown>,
    });

    return this.findOne(policy.policyId.toString(), companyId);
  }

  async update(id: string, companyId: string, dto: UpdateDataAccessPolicyDto, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw new NotFoundException('Data access policy');

    if (dto.code) {
      const duplicate = await this.repository.findByCode(companyId, dto.code.trim().toUpperCase());
      if (duplicate && duplicate.policyId !== existing.policyId) {
        throw new ConflictException('Data access policy code already exists');
      }
    }

    const touchingScopes =
      dto.branchIds !== undefined ||
      dto.departmentIds !== undefined ||
      dto.warehouseIds !== undefined;

    if (touchingScopes) {
      const next = {
        branchIds:
          dto.branchIds !== undefined
            ? [...new Set(dto.branchIds)]
            : existing.branches.map((b) => b.branchId.toString()),
        departmentIds:
          dto.departmentIds !== undefined
            ? [...new Set(dto.departmentIds)]
            : existing.departments.map((d) => d.departmentId.toString()),
        warehouseIds:
          dto.warehouseIds !== undefined
            ? [...new Set(dto.warehouseIds)]
            : existing.warehouses.map((w) => w.warehouseId.toString()),
      };
      await this.assertScopeIdsBelongToCompany(companyId, next);
      await this.repository.replacePolicyScopes(id, next);
    }

    await this.repository.update(id, dto, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'DataAccessPolicy',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return this.findOne(id, companyId);
  }

  async remove(id: string, companyId: string, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw new NotFoundException('Data access policy');

    await this.repository.softDelete(id, actorId);
    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'DataAccessPolicy',
      entityId: id,
    });
    return { message: 'Data access policy deleted' };
  }

  async getUserDataAccessPolicies(companyId: string, userId: string) {
    const user = await this.repository.findUser(companyId, userId);
    if (!user) throw new NotFoundException('User');
    const rows = await this.repository.getUserPolicyAssignments(companyId, userId);
    return serialize(
      rows.map((row) => ({
        ...row,
        policy: this.toPolicyResponse(row.policy as PolicyWithScopes),
      })),
    );
  }

  async assignUserDataAccessPolicy(
    companyId: string,
    userId: string,
    dto: AssignUserDataAccessPolicyDto,
    actorId: string,
  ) {
    const user = await this.repository.findUser(companyId, userId);
    if (!user) throw new NotFoundException('User');

    const policies = await this.repository.findPoliciesByIds(companyId, [dto.policyId]);
    if (policies.length !== 1) {
      throw new BusinessException('policyId is invalid for this company');
    }

    await this.repository.assignUserPolicy(companyId, userId, dto.policyId);
    await this.userContextCache.invalidate(userId, companyId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'UserDataAccessPolicy',
      entityId: userId,
      newValue: { assignedPolicyId: dto.policyId },
    });

    return this.getUserDataAccessPolicies(companyId, userId);
  }

  async removeUserDataAccessPolicy(
    companyId: string,
    userId: string,
    policyId: string,
    actorId: string,
  ) {
    const user = await this.repository.findUser(companyId, userId);
    if (!user) throw new NotFoundException('User');

    const { count } = await this.repository.removeUserPolicy(companyId, userId, policyId);
    if (count === 0) throw new NotFoundException('User data access policy assignment');

    await this.userContextCache.invalidate(userId, companyId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'UserDataAccessPolicy',
      entityId: userId,
      newValue: { removedPolicyId: policyId },
    });

    return this.getUserDataAccessPolicies(companyId, userId);
  }

  /** Legacy replace-all (FE drawer). Prefer POST/DELETE assign APIs for V1 spec. */
  async setUserDataAccessPolicies(
    companyId: string,
    userId: string,
    dto: SetUserDataAccessPoliciesDto,
    actorId: string,
  ) {
    const user = await this.repository.findUser(companyId, userId);
    if (!user) throw new NotFoundException('User');

    const ids = [...new Set(dto.policyIds ?? [])];
    const existing = await this.repository.findPoliciesByIds(companyId, ids);
    if (existing.length !== ids.length) {
      throw new BusinessException('One or more policyIds are invalid for this company');
    }

    await this.repository.replaceUserPolicyAssignments(companyId, userId, ids);
    await this.userContextCache.invalidate(userId, companyId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'UserDataAccessPolicy',
      entityId: userId,
      newValue: { policyIds: ids },
    });

    return this.getUserDataAccessPolicies(companyId, userId);
  }

  /**
   * Effective WHERE scope = UNION of active policies.
   * - No assigned policies → isRestricted=false (legacy unrestricted; admins without policies keep working)
   * - Assigned policies present → isRestricted=true; empty junction rows = NO access on that dimension
   */
  async resolveUserDataScope(userId: string, companyId: string): Promise<UserDataAccessScope> {
    const rows = await this.repository.resolveUserDataScope(userId, companyId);
    if (rows.length === 0) {
      return {
        isRestricted: false,
        branchIds: [],
        departmentIds: [],
        warehouseIds: [],
      };
    }

    const branchIds = new Set<string>();
    const departmentIds = new Set<string>();
    const warehouseIds = new Set<string>();

    for (const row of rows) {
      for (const b of row.policy.branches) branchIds.add(b.branchId.toString());
      for (const d of row.policy.departments) departmentIds.add(d.departmentId.toString());
      for (const w of row.policy.warehouses) warehouseIds.add(w.warehouseId.toString());
    }

    return {
      isRestricted: true,
      branchIds: [...branchIds],
      departmentIds: [...departmentIds],
      warehouseIds: [...warehouseIds],
    };
  }

  /**
   * Shared WHERE check for scoped business records.
   * Call after permission (WHAT) checks. Returns false → caller should DENY (403).
   */
  async canAccessRecord(params: {
    userId: string;
    companyId: string;
    branchId?: string | null;
    departmentId?: string | null;
    warehouseId?: string | null;
  }): Promise<boolean> {
    const scope = await this.resolveUserDataScope(params.userId, params.companyId);
    if (!scope.isRestricted) return true;

    if (params.branchId != null && params.branchId !== '') {
      if (!scope.branchIds.includes(params.branchId)) return false;
    }
    if (params.departmentId != null && params.departmentId !== '') {
      if (!scope.departmentIds.includes(params.departmentId)) return false;
    }
    if (params.warehouseId != null && params.warehouseId !== '') {
      if (!scope.warehouseIds.includes(params.warehouseId)) return false;
    }

    return true;
  }

  async assertWarehouseScope(userId: string, companyId: string, warehouseId: string) {
    const allowed = await this.canAccessRecord({ userId, companyId, warehouseId });
    if (!allowed) {
      throw new BusinessException(
        'Access denied: warehouse is out of your policy scope',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /**
   * Allocate a company-unique policy code among non-deleted rows.
   * If requested is taken, appends _2, _3, ... (max length 60).
   * Soft-deleted codes are reusable (findByCode ignores deletedAt; softDelete frees DB unique).
   */
  async resolveUniqueCode(companyId: string, requested: string): Promise<string> {
    const base = requested.trim().toUpperCase().slice(0, 60);
    if (!base) {
      throw new BusinessException('code is required');
    }

    let candidate = base;
    let n = 2;
    while (await this.repository.findByCode(companyId, candidate)) {
      const suffix = `_${n}`;
      candidate = `${base.slice(0, Math.max(1, 60 - suffix.length))}${suffix}`;
      n += 1;
      if (n > 1000) {
        throw new ConflictException('Unable to allocate unique policy code');
      }
    }
    return candidate;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }

  private normalizeScopeIds(dto: {
    branchIds?: string[];
    departmentIds?: string[];
    warehouseIds?: string[];
  }) {
    return {
      branchIds: [...new Set(dto.branchIds ?? [])],
      departmentIds: [...new Set(dto.departmentIds ?? [])],
      warehouseIds: [...new Set(dto.warehouseIds ?? [])],
    };
  }

  private toPolicyResponse(policy: PolicyWithScopes) {
    return {
      policyId: policy.policyId,
      companyId: policy.companyId,
      code: policy.code,
      name: policy.name,
      description: policy.description,
      isActive: policy.isActive,
      createdAt: policy.createdAt,
      updatedAt: policy.updatedAt,
      deletedAt: policy.deletedAt,
      branchIds: policy.branches.map((b) => b.branchId.toString()),
      departmentIds: policy.departments.map((d) => d.departmentId.toString()),
      warehouseIds: policy.warehouses.map((w) => w.warehouseId.toString()),
    };
  }

  private async assertScopeIdsBelongToCompany(
    companyId: string,
    scopes: { branchIds: string[]; departmentIds: string[]; warehouseIds: string[] },
  ) {
    for (const branchId of scopes.branchIds) {
      if (!(await this.repository.findBranch(companyId, branchId))) {
        throw new BusinessException('Invalid branchId for company');
      }
    }
    for (const departmentId of scopes.departmentIds) {
      if (!(await this.repository.findDepartment(companyId, departmentId))) {
        throw new BusinessException('Invalid departmentId for company');
      }
    }
    for (const warehouseId of scopes.warehouseIds) {
      if (!(await this.repository.findWarehouse(companyId, warehouseId))) {
        throw new BusinessException('Invalid warehouseId for company');
      }
    }
  }
}
