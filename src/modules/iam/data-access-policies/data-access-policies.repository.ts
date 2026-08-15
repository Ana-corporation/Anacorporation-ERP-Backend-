import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, ListFilterOptions, resolveOrderBy } from '@/common/utils/prisma-filter.util';
import {
  CreateDataAccessPolicyDto,
  UpdateDataAccessPolicyDto,
} from './dto/data-access-policy.dto';

const DATA_ACCESS_POLICIES_LIST_FILTER: ListFilterOptions = {
  contains: { code: 'code', name: 'name' },
  booleans: { isActive: 'isActive' },
  dateRange: { field: 'createdAt' },
  searchFields: ['code', 'name', 'description'],
  sortFields: ['code', 'name', 'createdAt'],
  defaultSortField: 'createdAt',
};

const policyScopeInclude = {
  branches: { select: { branchId: true } },
  departments: { select: { departmentId: true } },
  warehouses: { select: { warehouseId: true } },
} as const;

@Injectable()
export class DataAccessPoliciesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByCompany(companyId: string, query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = buildListWhere(
      { companyId: parseBigIntId(companyId), deletedAt: null },
      query,
      DATA_ACCESS_POLICIES_LIST_FILTER,
    ) as Prisma.DataAccessPolicyWhereInput;

    return this.prisma
      .$transaction([
        this.prisma.dataAccessPolicy.findMany({
          where,
          skip,
          take: limit,
          orderBy: resolveOrderBy(query, DATA_ACCESS_POLICIES_LIST_FILTER),
          include: policyScopeInclude,
        }),
        this.prisma.dataAccessPolicy.count({ where }),
      ])
      .then(([items, total]) => ({ items, total, page, limit }));
  }

  findById(id: string, companyId: string) {
    return this.prisma.dataAccessPolicy.findFirst({
      where: {
        policyId: parseBigIntId(id),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
      include: policyScopeInclude,
    });
  }

  findByCode(companyId: string, code: string) {
    return this.prisma.dataAccessPolicy.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        code,
        deletedAt: null,
      },
    });
  }

  create(companyId: string, dto: CreateDataAccessPolicyDto, actorId: string) {
    return this.prisma.dataAccessPolicy.create({
      data: {
        companyId: parseBigIntId(companyId),
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        description: dto.description,
        isActive: dto.isActive ?? true,
        createdBy: parseBigIntId(actorId),
      },
    });
  }

  update(id: string, dto: UpdateDataAccessPolicyDto, actorId: string) {
    return this.prisma.dataAccessPolicy.update({
      where: { policyId: parseBigIntId(id) },
      data: {
        ...(dto.code !== undefined ? { code: dto.code.trim().toUpperCase() } : {}),
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        updatedBy: parseBigIntId(actorId),
        updatedAt: new Date(),
      },
    });
  }

  softDelete(id: string, actorId: string) {
    const policyId = parseBigIntId(id);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.dataAccessPolicy.findUnique({
        where: { policyId },
        select: { code: true },
      });
      if (!existing) return null;

      // Free (companyId, code) unique so soft-deleted codes can be reused on create.
      const freedSuffix = `__DEL_${policyId}`;
      const freedCode = `${existing.code.slice(0, Math.max(1, 60 - freedSuffix.length))}${freedSuffix}`;

      return tx.dataAccessPolicy.update({
        where: { policyId },
        data: {
          deletedAt: new Date(),
          deletedBy: parseBigIntId(actorId),
          isActive: false,
          code: freedCode,
          updatedAt: new Date(),
        },
      });
    });
  }

  replacePolicyScopes(
    policyId: string,
    scopes: {
      branchIds: string[];
      departmentIds: string[];
      warehouseIds: string[];
    },
  ) {
    const pid = parseBigIntId(policyId);
    return this.prisma.$transaction(async (tx) => {
      await tx.dataAccessPolicyBranch.deleteMany({ where: { policyId: pid } });
      await tx.dataAccessPolicyDepartment.deleteMany({ where: { policyId: pid } });
      await tx.dataAccessPolicyWarehouse.deleteMany({ where: { policyId: pid } });

      if (scopes.branchIds.length > 0) {
        await tx.dataAccessPolicyBranch.createMany({
          data: scopes.branchIds.map((branchId) => ({
            policyId: pid,
            branchId: parseBigIntId(branchId),
          })),
          skipDuplicates: true,
        });
      }
      if (scopes.departmentIds.length > 0) {
        await tx.dataAccessPolicyDepartment.createMany({
          data: scopes.departmentIds.map((departmentId) => ({
            policyId: pid,
            departmentId: parseBigIntId(departmentId),
          })),
          skipDuplicates: true,
        });
      }
      if (scopes.warehouseIds.length > 0) {
        await tx.dataAccessPolicyWarehouse.createMany({
          data: scopes.warehouseIds.map((warehouseId) => ({
            policyId: pid,
            warehouseId: parseBigIntId(warehouseId),
          })),
          skipDuplicates: true,
        });
      }
    });
  }

  findBranch(companyId: string, branchId: string) {
    return this.prisma.branch.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        branchId: parseBigIntId(branchId),
        deletedAt: null,
      },
      select: { branchId: true },
    });
  }

  findDepartment(companyId: string, departmentId: string) {
    return this.prisma.department.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        departmentId: parseBigIntId(departmentId),
        deletedAt: null,
      },
      select: { departmentId: true },
    });
  }

  findWarehouse(companyId: string, warehouseId: string) {
    return this.prisma.warehouse.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        warehouseId: parseBigIntId(warehouseId),
        deletedAt: null,
      },
      select: { warehouseId: true },
    });
  }

  findUser(companyId: string, userId: string) {
    return this.prisma.userCompany.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        userId: parseBigIntId(userId),
        deletedAt: null,
      },
      select: { userId: true },
    });
  }

  findPoliciesByIds(companyId: string, policyIds: string[]) {
    if (policyIds.length === 0) return Promise.resolve([]);
    return this.prisma.dataAccessPolicy.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        policyId: { in: policyIds.map((id) => parseBigIntId(id)) },
        deletedAt: null,
      },
      select: { policyId: true },
    });
  }

  getUserPolicyAssignments(companyId: string, userId: string) {
    return this.prisma.userDataAccessPolicy.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        userId: parseBigIntId(userId),
        isActive: true,
      },
      include: {
        policy: { include: policyScopeInclude },
      },
      orderBy: { userDataAccessPolicyId: 'asc' },
    });
  }

  assignUserPolicy(companyId: string, userId: string, policyId: string) {
    const cid = parseBigIntId(companyId);
    const uid = parseBigIntId(userId);
    const pid = parseBigIntId(policyId);
    return this.prisma.userDataAccessPolicy.upsert({
      where: {
        companyId_userId_policyId: {
          companyId: cid,
          userId: uid,
          policyId: pid,
        },
      },
      create: {
        companyId: cid,
        userId: uid,
        policyId: pid,
        isActive: true,
      },
      update: {
        isActive: true,
        updatedAt: new Date(),
      },
    });
  }

  removeUserPolicy(companyId: string, userId: string, policyId: string) {
    return this.prisma.userDataAccessPolicy.deleteMany({
      where: {
        companyId: parseBigIntId(companyId),
        userId: parseBigIntId(userId),
        policyId: parseBigIntId(policyId),
      },
    });
  }

  replaceUserPolicyAssignments(companyId: string, userId: string, policyIds: string[]) {
    const cid = parseBigIntId(companyId);
    const uid = parseBigIntId(userId);
    const ids = policyIds.map((id) => parseBigIntId(id));
    return this.prisma.$transaction(async (tx) => {
      await tx.userDataAccessPolicy.deleteMany({
        where: { companyId: cid, userId: uid },
      });
      if (ids.length === 0) return;
      await tx.userDataAccessPolicy.createMany({
        data: ids.map((policyId) => ({
          companyId: cid,
          userId: uid,
          policyId,
          isActive: true,
        })),
      });
    });
  }

  resolveUserDataScope(userId: string, companyId: string) {
    return this.prisma.userDataAccessPolicy.findMany({
      where: {
        userId: parseBigIntId(userId),
        companyId: parseBigIntId(companyId),
        isActive: true,
        policy: {
          deletedAt: null,
          isActive: true,
        },
      },
      include: {
        policy: {
          include: policyScopeInclude,
        },
      },
    });
  }
}
