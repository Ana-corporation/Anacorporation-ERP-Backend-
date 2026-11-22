import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { BusinessException, NotFoundException } from '@/common/exceptions/business.exception';
import { parseBigIntId, serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { DocumentNumberService } from '@/modules/shared/number-series/document-number.service';
import {
  CreateEmployeeDto,
  EmployeeLookupQueryDto,
  UpdateEmployeeDto,
} from './dto/employee.dto';
import { EmployeesRepository } from './employees.repository';

export const EMPLOYEE_ERROR_CODES = {
  NOT_FOUND: 'EMPLOYEE_NOT_FOUND',
  CODE_EXISTS: 'EMPLOYEE_CODE_EXISTS',
  SELF_MANAGER: 'EMPLOYEE_SELF_MANAGER',
} as const;

const notFound = () => new NotFoundException('Employee');

const codeExists = () =>
  new BusinessException(
    'An employee with this code already exists',
    HttpStatus.CONFLICT,
    [{ field: 'employeeCode', message: 'Code already used' }],
    EMPLOYEE_ERROR_CODES.CODE_EXISTS,
  );

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function displayName(row: { preferredName: string | null; firstName: string; lastName: string | null }) {
  const preferred = row.preferredName?.trim();
  if (preferred) return preferred;
  return [row.firstName, row.lastName].filter(Boolean).join(' ').trim();
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly repository: EmployeesRepository,
    private readonly auditService: AuditService,
    private readonly documentNumbers: DocumentNumberService,
  ) {}

  async findAll(companyId: string, query: PaginationQueryDto) {
    const { items, total, page, limit } = await this.repository.findManyByCompany(companyId, query);
    return serialize(toPaginatedResult(items.map((item) => this.toPayload(item)), total, page, limit));
  }

  async lookup(companyId: string, query: EmployeeLookupQueryDto) {
    const rows = await this.repository.lookup(companyId, {
      search: query.search,
      limit: query.limit,
      departmentId: query.departmentId,
      designationId: query.designationId,
      warehouseId: query.warehouseId,
      branchId: query.branchId,
      status: query.status,
    });
    return serialize({
      items: rows.map((row) => ({
        employeeId: row.employeeId.toString(),
        employeeCode: row.employeeCode,
        displayName: displayName(row),
        firstName: row.firstName,
        lastName: row.lastName,
        preferredName: row.preferredName,
        employmentStatus: row.employmentStatus,
        employmentType: row.employmentType,
        department: row.department
          ? { departmentId: row.department.departmentId.toString(), name: row.department.name }
          : null,
        designation: row.designation
          ? { designationId: row.designation.designationId.toString(), name: row.designation.name }
          : null,
        branch: row.branch ? { branchId: row.branch.branchId.toString(), name: row.branch.name } : null,
        warehouse: row.warehouse
          ? { warehouseId: row.warehouse.warehouseId.toString(), name: row.warehouse.name }
          : null,
      })),
    });
  }

  async findOne(id: string, companyId: string) {
    const employee = await this.repository.findById(id, companyId);
    if (!employee) throw notFound();
    return serialize(this.toPayload(employee));
  }

  async create(companyId: string, dto: CreateEmployeeDto, actorId: string) {
    await this.assertOrgRefs(companyId, dto);

    let created;
    try {
      created = await this.repository.transaction(async (tx) => {
        const manual = dto.employeeCode?.trim();
        const employeeCode =
          manual || (await this.documentNumbers.reserve(tx, parseBigIntId(companyId, 'companyId'), 'EMPLOYEE'));
        const clash = await this.repository.findByCode(companyId, employeeCode, tx);
        if (clash) throw codeExists();
        return this.repository.create(
          companyId,
          {
            employeeCode,
            firstName: dto.firstName,
            middleName: dto.middleName,
            lastName: dto.lastName,
            preferredName: dto.preferredName,
            email: dto.email,
            mobile: dto.mobile,
            branchId: dto.branchId,
            warehouseId: dto.warehouseId,
            departmentId: dto.departmentId,
            designationId: dto.designationId,
            reportingManagerId: dto.reportingManagerId,
            joiningDate: dto.joiningDate,
            employmentType: dto.employmentType ?? null,
            employmentStatus: dto.employmentStatus ?? 'active',
          },
          actorId,
          tx,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw codeExists();
      throw error;
    }

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'Employee',
      entityId: created.employeeId.toString(),
      newValue: { employeeCode: created.employeeCode, firstName: created.firstName },
    });

    return serialize(this.toPayload(created));
  }

  async update(id: string, companyId: string, dto: UpdateEmployeeDto, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw notFound();

    await this.assertOrgRefs(companyId, dto);

    if (dto.reportingManagerId && dto.reportingManagerId === id) {
      throw new BusinessException(
        'Employee cannot be their own reporting manager',
        HttpStatus.CONFLICT,
        [{ field: 'reportingManagerId', message: 'Cannot report to self' }],
        EMPLOYEE_ERROR_CODES.SELF_MANAGER,
      );
    }

    const employee = await this.repository.update(id, dto, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'Employee',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return serialize(this.toPayload(employee));
  }

  async remove(id: string, companyId: string, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw notFound();

    await this.repository.softDelete(id, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'Employee',
      entityId: id,
    });

    return { message: 'Employee deleted' };
  }

  /**
   * Used by invite flow — create or link Employee while keeping temp-password invite.
   */
  async ensureLinkedForInvite(params: {
    companyId: string;
    userId: string;
    actorId: string;
    employeeRecordId?: string | null;
    employeeCode?: string | null;
    firstName: string;
    lastName?: string | null;
    email?: string | null;
    mobile?: string | null;
  }) {
    const { companyId, userId, actorId, employeeRecordId, employeeCode, firstName, lastName, email, mobile } =
      params;

    if (employeeRecordId) {
      const employee = await this.repository.findById(employeeRecordId, companyId);
      if (!employee) {
        throw new BusinessException('employeeRecordId must belong to this company', HttpStatus.BAD_REQUEST, [
          { field: 'employeeRecordId', message: 'Invalid employee for company' },
        ]);
      }
      if (employee.userId && employee.userId.toString() !== userId) {
        throw new BusinessException(
          'Employee is already linked to another user',
          HttpStatus.CONFLICT,
          undefined,
          EMPLOYEE_ERROR_CODES.CODE_EXISTS,
        );
      }
      if (!employee.userId) {
        await this.repository.linkUser(employeeRecordId, userId, actorId);
      }
      return employee;
    }

    const code = employeeCode?.trim();
    if (code) {
      const existing = await this.repository.findByCode(companyId, code);
      if (existing) {
        if (existing.userId && existing.userId.toString() !== userId) {
          throw new BusinessException(
            'Employee code is already linked to another user',
            HttpStatus.CONFLICT,
            [{ field: 'employeeCode', message: 'Code already used' }],
            EMPLOYEE_ERROR_CODES.CODE_EXISTS,
          );
        }
        if (!existing.userId) {
          await this.repository.linkUser(existing.employeeId.toString(), userId, actorId);
        }
        return existing;
      }
    }

    const linked = await this.repository.findByUserId(companyId, userId);
    if (linked) return linked;

    return this.repository.transaction(async (tx) => {
      const employeeCodeResolved =
        code || (await this.documentNumbers.reserve(tx, parseBigIntId(companyId, 'companyId'), 'EMPLOYEE'));
      return this.repository.create(
        companyId,
        {
          employeeCode: employeeCodeResolved,
          firstName,
          lastName: lastName ?? '',
          email: email ?? null,
          mobile: mobile ?? null,
          employmentStatus: 'active',
          userId,
        },
        actorId,
        tx,
      );
    });
  }

  private async assertOrgRefs(
    companyId: string,
    dto: {
      branchId?: string | null;
      warehouseId?: string | null;
      departmentId?: string | null;
      designationId?: string | null;
      reportingManagerId?: string | null;
    },
  ) {
    if (dto.branchId) {
      const found = await this.repository.findBranch(companyId, dto.branchId);
      if (!found) {
        throw new BusinessException('branchId must belong to this company', HttpStatus.BAD_REQUEST, [
          { field: 'branchId', message: 'Invalid id for company' },
        ]);
      }
    }
    if (dto.warehouseId) {
      const found = await this.repository.findWarehouse(companyId, dto.warehouseId);
      if (!found) {
        throw new BusinessException('warehouseId must belong to this company', HttpStatus.BAD_REQUEST, [
          { field: 'warehouseId', message: 'Invalid id for company' },
        ]);
      }
    }
    if (dto.departmentId) {
      const found = await this.repository.findDepartment(companyId, dto.departmentId);
      if (!found) {
        throw new BusinessException('departmentId must belong to this company', HttpStatus.BAD_REQUEST, [
          { field: 'departmentId', message: 'Invalid id for company' },
        ]);
      }
    }
    if (dto.designationId) {
      const found = await this.repository.findDesignation(companyId, dto.designationId);
      if (!found) {
        throw new BusinessException('designationId must belong to this company', HttpStatus.BAD_REQUEST, [
          { field: 'designationId', message: 'Invalid id for company' },
        ]);
      }
    }
    if (dto.reportingManagerId) {
      const manager = await this.repository.findById(dto.reportingManagerId, companyId);
      if (!manager) {
        throw new BusinessException('reportingManagerId must belong to this company', HttpStatus.BAD_REQUEST, [
          { field: 'reportingManagerId', message: 'Invalid id for company' },
        ]);
      }
    }
  }

  private toPayload(employee: {
    employeeId: bigint;
    companyId: bigint;
    userId: bigint | null;
    employeeCode: string;
    firstName: string;
    middleName: string | null;
    lastName: string | null;
    preferredName: string | null;
    email: string | null;
    mobile: string | null;
    branchId: bigint | null;
    warehouseId: bigint | null;
    departmentId: bigint | null;
    designationId: bigint | null;
    reportingManagerId: bigint | null;
    joiningDate: Date | null;
    employmentType: string | null;
    employmentStatus: string;
    profilePhoto: string | null;
    profileCompletionPercentage: number;
    department?: { departmentId: bigint; departmentCode: string; name: string } | null;
    designation?: { designationId: bigint; designationCode: string; name: string } | null;
    branch?: { branchId: bigint; branchCode: string; name: string } | null;
    warehouse?: { warehouseId: bigint; warehouseCode: string; name: string } | null;
    reportingManager?: {
      employeeId: bigint;
      employeeCode: string;
      firstName: string;
      lastName: string | null;
      preferredName?: string | null;
    } | null;
  }) {
    return {
      employeeId: employee.employeeId.toString(),
      companyId: employee.companyId.toString(),
      userId: employee.userId?.toString() ?? null,
      employeeCode: employee.employeeCode,
      firstName: employee.firstName,
      middleName: employee.middleName,
      lastName: employee.lastName,
      preferredName: employee.preferredName,
      displayName: displayName(employee),
      email: employee.email,
      mobile: employee.mobile,
      branchId: employee.branchId?.toString() ?? null,
      warehouseId: employee.warehouseId?.toString() ?? null,
      departmentId: employee.departmentId?.toString() ?? null,
      designationId: employee.designationId?.toString() ?? null,
      reportingManagerId: employee.reportingManagerId?.toString() ?? null,
      joiningDate: employee.joiningDate,
      employmentType: employee.employmentType,
      employmentStatus: employee.employmentStatus,
      profilePhoto: employee.profilePhoto,
      profileCompletionPercentage: employee.profileCompletionPercentage,
      department: employee.department
        ? {
            departmentId: employee.department.departmentId.toString(),
            departmentCode: employee.department.departmentCode,
            name: employee.department.name,
          }
        : null,
      designation: employee.designation
        ? {
            designationId: employee.designation.designationId.toString(),
            designationCode: employee.designation.designationCode,
            name: employee.designation.name,
          }
        : null,
      branch: employee.branch
        ? {
            branchId: employee.branch.branchId.toString(),
            branchCode: employee.branch.branchCode,
            name: employee.branch.name,
          }
        : null,
      warehouse: employee.warehouse
        ? {
            warehouseId: employee.warehouse.warehouseId.toString(),
            warehouseCode: employee.warehouse.warehouseCode,
            name: employee.warehouse.name,
          }
        : null,
      reportingManager: employee.reportingManager
        ? {
            employeeId: employee.reportingManager.employeeId.toString(),
            employeeCode: employee.reportingManager.employeeCode,
            firstName: employee.reportingManager.firstName,
            lastName: employee.reportingManager.lastName,
            displayName: displayName({
              preferredName: employee.reportingManager.preferredName ?? null,
              firstName: employee.reportingManager.firstName,
              lastName: employee.reportingManager.lastName,
            }),
          }
        : null,
    };
  }
}
