import { Injectable } from '@nestjs/common';
import { EmploymentStatus, EmploymentType, Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { LOOKUP_EMPLOYMENT_STATUSES, UpdateEmployeeDto } from './dto/employee.dto';

const EMPLOYEES_LIST_FILTER: ListFilterOptions = {
  contains: { code: 'employeeCode', name: 'firstName', email: 'email' },
  exact: { status: 'employmentStatus', warehouseId: 'warehouseId' },
  dateRange: { field: 'createdAt' },
  searchFields: ['employeeCode', 'firstName', 'middleName', 'lastName', 'preferredName', 'email', 'mobile'],
  sortFields: ['employeeCode', 'firstName', 'lastName', 'createdAt'],
  defaultSortField: 'createdAt',
  tieBreaker: 'employeeId',
};

const orgSelect = { departmentId: true, departmentCode: true, name: true } as const;
const designationSelect = { designationId: true, designationCode: true, name: true } as const;
const branchSelect = { branchId: true, branchCode: true, name: true } as const;
const warehouseSelect = { warehouseId: true, warehouseCode: true, name: true } as const;
const managerSelect = {
  employeeId: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  preferredName: true,
} as const;

type DbClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class EmployeesRepository {
  constructor(readonly prisma: PrismaService) {}

  private db(client?: DbClient): Prisma.TransactionClient {
    if (client) return client as unknown as Prisma.TransactionClient;
    return this.prisma as unknown as Prisma.TransactionClient;
  }

  transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => fn(tx as unknown as Prisma.TransactionClient));
  }

  findManyByCompany(companyId: string, query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = this.castIds(
      buildListWhere(
        { companyId: parseBigIntId(companyId), deletedAt: null },
        query,
        EMPLOYEES_LIST_FILTER,
      ),
    );

    return this.prisma
      .$transaction([
        this.prisma.employee.findMany({
          where,
          skip,
          take: limit,
          orderBy: resolveOrderBy(query, EMPLOYEES_LIST_FILTER),
          include: this.publicInclude(),
        }),
        this.prisma.employee.count({ where }),
      ])
      .then(([items, total]) => ({ items, total, page, limit }));
  }

  lookup(
    companyId: string,
    opts: {
      search?: string;
      limit: number;
      departmentId?: string | null;
      designationId?: string | null;
      warehouseId?: string | null;
      branchId?: string | null;
      status?: (typeof LOOKUP_EMPLOYMENT_STATUSES)[number] | EmploymentStatus;
    },
  ) {
    const statuses = opts.status
      ? [opts.status]
      : [...LOOKUP_EMPLOYMENT_STATUSES];
    return this.prisma.employee.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        employmentStatus: { in: statuses as EmploymentStatus[] },
        ...(opts.departmentId ? { departmentId: parseBigIntId(opts.departmentId) } : {}),
        ...(opts.designationId ? { designationId: parseBigIntId(opts.designationId) } : {}),
        ...(opts.warehouseId ? { warehouseId: parseBigIntId(opts.warehouseId) } : {}),
        ...(opts.branchId ? { branchId: parseBigIntId(opts.branchId) } : {}),
        ...(opts.search
          ? {
              OR: [
                { employeeCode: { contains: opts.search, mode: 'insensitive' } },
                { firstName: { contains: opts.search, mode: 'insensitive' } },
                { lastName: { contains: opts.search, mode: 'insensitive' } },
                { preferredName: { contains: opts.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      take: opts.limit,
      orderBy: [{ firstName: 'asc' }, { employeeId: 'asc' }],
      include: this.publicInclude(),
    });
  }

  findById(id: string, companyId: string) {
    return this.prisma.employee.findFirst({
      where: {
        employeeId: parseBigIntId(id),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
      include: this.publicInclude(),
    });
  }

  findByCode(companyId: string, employeeCode: string, client: DbClient = this.prisma) {
    return this.db(client).employee.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        employeeCode,
        deletedAt: null,
      },
    });
  }

  findByUserId(companyId: string, userId: string) {
    return this.prisma.employee.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        userId: parseBigIntId(userId),
        deletedAt: null,
      },
    });
  }

  findBranch(companyId: string, branchId: string) {
    return this.prisma.branch.findFirst({
      where: { branchId: parseBigIntId(branchId), companyId: parseBigIntId(companyId), deletedAt: null },
      select: { branchId: true },
    });
  }

  findWarehouse(companyId: string, warehouseId: string) {
    return this.prisma.warehouse.findFirst({
      where: { warehouseId: parseBigIntId(warehouseId), companyId: parseBigIntId(companyId), deletedAt: null },
      select: { warehouseId: true },
    });
  }

  findDepartment(companyId: string, departmentId: string) {
    return this.prisma.department.findFirst({
      where: { departmentId: parseBigIntId(departmentId), companyId: parseBigIntId(companyId), deletedAt: null },
      select: { departmentId: true },
    });
  }

  findDesignation(companyId: string, designationId: string) {
    return this.prisma.designation.findFirst({
      where: { designationId: parseBigIntId(designationId), companyId: parseBigIntId(companyId), deletedAt: null },
      select: { designationId: true },
    });
  }

  create(
    companyId: string,
    data: {
      employeeCode: string;
      firstName: string;
      middleName?: string | null;
      lastName?: string | null;
      preferredName?: string | null;
      email?: string | null;
      mobile?: string | null;
      branchId?: string | null;
      warehouseId?: string | null;
      departmentId?: string | null;
      designationId?: string | null;
      reportingManagerId?: string | null;
      joiningDate?: string | null;
      employmentType?: EmploymentType | null;
      employmentStatus?: EmploymentStatus;
      userId?: string | null;
    },
    createdBy?: string,
    client: DbClient = this.prisma,
  ) {
    return this.db(client).employee.create({
      data: {
        companyId: parseBigIntId(companyId),
        userId: data.userId ? parseBigIntId(data.userId) : null,
        employeeCode: data.employeeCode.trim(),
        firstName: data.firstName.trim(),
        middleName: data.middleName?.trim() || null,
        lastName: (data.lastName ?? '').trim() || null,
        preferredName: data.preferredName?.trim() || null,
        email: data.email?.trim().toLowerCase() || null,
        mobile: data.mobile || null,
        branchId: data.branchId ? parseBigIntId(data.branchId) : null,
        warehouseId: data.warehouseId ? parseBigIntId(data.warehouseId) : null,
        departmentId: data.departmentId ? parseBigIntId(data.departmentId) : null,
        designationId: data.designationId ? parseBigIntId(data.designationId) : null,
        reportingManagerId: data.reportingManagerId ? parseBigIntId(data.reportingManagerId) : null,
        joiningDate: data.joiningDate ? new Date(data.joiningDate) : null,
        employmentType: data.employmentType ?? null,
        employmentStatus: data.employmentStatus ?? EmploymentStatus.active,
        createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
      },
      include: this.publicInclude(),
    });
  }

  update(id: string, dto: UpdateEmployeeDto, updatedBy?: string) {
    return this.prisma.employee.update({
      where: { employeeId: parseBigIntId(id) },
      data: {
        ...(dto.firstName !== undefined ? { firstName: dto.firstName.trim() } : {}),
        ...(dto.middleName !== undefined ? { middleName: dto.middleName?.trim() || null } : {}),
        ...(dto.lastName !== undefined ? { lastName: dto.lastName?.trim() || null } : {}),
        ...(dto.preferredName !== undefined ? { preferredName: dto.preferredName?.trim() || null } : {}),
        ...(dto.email !== undefined ? { email: dto.email ? dto.email.trim().toLowerCase() : null } : {}),
        ...(dto.mobile !== undefined ? { mobile: dto.mobile } : {}),
        ...(dto.branchId !== undefined ? { branchId: dto.branchId ? parseBigIntId(dto.branchId) : null } : {}),
        ...(dto.warehouseId !== undefined
          ? { warehouseId: dto.warehouseId ? parseBigIntId(dto.warehouseId) : null }
          : {}),
        ...(dto.departmentId !== undefined
          ? { departmentId: dto.departmentId ? parseBigIntId(dto.departmentId) : null }
          : {}),
        ...(dto.designationId !== undefined
          ? { designationId: dto.designationId ? parseBigIntId(dto.designationId) : null }
          : {}),
        ...(dto.reportingManagerId !== undefined
          ? { reportingManagerId: dto.reportingManagerId ? parseBigIntId(dto.reportingManagerId) : null }
          : {}),
        ...(dto.joiningDate !== undefined
          ? { joiningDate: dto.joiningDate ? new Date(dto.joiningDate) : null }
          : {}),
        ...(dto.employmentType !== undefined
          ? { employmentType: dto.employmentType as EmploymentType | null }
          : {}),
        ...(dto.employmentStatus !== undefined
          ? { employmentStatus: dto.employmentStatus as EmploymentStatus }
          : {}),
        ...(dto.profilePhoto !== undefined ? { profilePhoto: dto.profilePhoto } : {}),
        updatedBy: updatedBy ? parseBigIntId(updatedBy) : undefined,
        updatedAt: new Date(),
        rowVersion: { increment: 1 },
      },
      include: this.publicInclude(),
    });
  }

  linkUser(employeeId: string, userId: string, updatedBy?: string) {
    return this.prisma.employee.update({
      where: { employeeId: parseBigIntId(employeeId) },
      data: {
        userId: parseBigIntId(userId),
        updatedBy: updatedBy ? parseBigIntId(updatedBy) : undefined,
        updatedAt: new Date(),
      },
      include: this.publicInclude(),
    });
  }

  softDelete(id: string, deletedBy?: string) {
    return this.prisma.employee.update({
      where: { employeeId: parseBigIntId(id) },
      data: {
        deletedAt: new Date(),
        deletedBy: deletedBy ? parseBigIntId(deletedBy) : undefined,
        employmentStatus: EmploymentStatus.inactive,
      },
    });
  }

  private castIds(where: Record<string, unknown>): Prisma.EmployeeWhereInput {
    if (typeof where.warehouseId === 'string' && /^\d+$/.test(where.warehouseId)) {
      return { ...where, warehouseId: BigInt(where.warehouseId) } as Prisma.EmployeeWhereInput;
    }
    if (Array.isArray(where.AND)) {
      const and = (where.AND as Record<string, unknown>[]).map((clause) => {
        if (typeof clause.warehouseId === 'string' && /^\d+$/.test(clause.warehouseId)) {
          return { ...clause, warehouseId: BigInt(clause.warehouseId) };
        }
        return clause;
      });
      return { ...where, AND: and } as Prisma.EmployeeWhereInput;
    }
    return where as Prisma.EmployeeWhereInput;
  }

  private publicInclude() {
    return {
      department: { select: orgSelect },
      designation: { select: designationSelect },
      branch: { select: branchSelect },
      warehouse: { select: warehouseSelect },
      reportingManager: { select: managerSelect },
    } satisfies Prisma.EmployeeInclude;
  }
}
