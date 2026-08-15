import { Injectable } from '@nestjs/common';
import { EmploymentStatus, EmploymentType, Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { UpdateEmployeeDto } from './dto/employee.dto';

const EMPLOYEES_LIST_FILTER: ListFilterOptions = {
  contains: { code: 'employeeCode', name: 'firstName', email: 'email' },
  exact: { employmentStatus: 'employmentStatus' },
  dateRange: { field: 'createdAt' },
  searchFields: ['employeeCode', 'firstName', 'lastName', 'email', 'mobile'],
  sortFields: ['employeeCode', 'firstName', 'lastName', 'createdAt'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class EmployeesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByCompany(companyId: string, query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = buildListWhere(
      { companyId: parseBigIntId(companyId), deletedAt: null },
      query,
      EMPLOYEES_LIST_FILTER,
    ) as Prisma.EmployeeWhereInput;

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

  findByCode(companyId: string, employeeCode: string) {
    return this.prisma.employee.findFirst({
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
      where: {
        branchId: parseBigIntId(branchId),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
      select: { branchId: true },
    });
  }

  findDepartment(companyId: string, departmentId: string) {
    return this.prisma.department.findFirst({
      where: {
        departmentId: parseBigIntId(departmentId),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
      select: { departmentId: true },
    });
  }

  findDesignation(companyId: string, designationId: string) {
    return this.prisma.designation.findFirst({
      where: {
        designationId: parseBigIntId(designationId),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
      select: { designationId: true },
    });
  }

  create(
    companyId: string,
    data: {
      employeeCode: string;
      firstName: string;
      lastName?: string | null;
      email?: string | null;
      mobile?: string | null;
      branchId?: string | null;
      departmentId?: string | null;
      designationId?: string | null;
      reportingManagerId?: string | null;
      joiningDate?: string | null;
      employmentType?: EmploymentType | null;
      employmentStatus?: EmploymentStatus;
      userId?: string | null;
    },
    createdBy?: string,
  ) {
    return this.prisma.employee.create({
      data: {
        companyId: parseBigIntId(companyId),
        userId: data.userId ? parseBigIntId(data.userId) : null,
        employeeCode: data.employeeCode.trim(),
        firstName: data.firstName.trim(),
        lastName: (data.lastName ?? '').trim() || null,
        email: data.email?.trim().toLowerCase() || null,
        mobile: data.mobile || null,
        branchId: data.branchId ? parseBigIntId(data.branchId) : null,
        departmentId: data.departmentId ? parseBigIntId(data.departmentId) : null,
        designationId: data.designationId ? parseBigIntId(data.designationId) : null,
        reportingManagerId: data.reportingManagerId
          ? parseBigIntId(data.reportingManagerId)
          : null,
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
        ...(dto.lastName !== undefined ? { lastName: dto.lastName?.trim() || null } : {}),
        ...(dto.email !== undefined
          ? { email: dto.email ? dto.email.trim().toLowerCase() : null }
          : {}),
        ...(dto.mobile !== undefined ? { mobile: dto.mobile } : {}),
        ...(dto.branchId !== undefined
          ? { branchId: dto.branchId ? parseBigIntId(dto.branchId) : null }
          : {}),
        ...(dto.departmentId !== undefined
          ? { departmentId: dto.departmentId ? parseBigIntId(dto.departmentId) : null }
          : {}),
        ...(dto.designationId !== undefined
          ? { designationId: dto.designationId ? parseBigIntId(dto.designationId) : null }
          : {}),
        ...(dto.reportingManagerId !== undefined
          ? {
              reportingManagerId: dto.reportingManagerId
                ? parseBigIntId(dto.reportingManagerId)
                : null,
            }
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

  private publicInclude() {
    return {
      department: { select: { departmentId: true, departmentCode: true, name: true } },
      designation: { select: { designationId: true, designationCode: true, name: true } },
      branch: { select: { branchId: true, branchCode: true, name: true } },
      reportingManager: {
        select: { employeeId: true, employeeCode: true, firstName: true, lastName: true },
      },
    } satisfies Prisma.EmployeeInclude;
  }
}
