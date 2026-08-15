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
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';
import { EmployeesRepository } from './employees.repository';

@Injectable()
export class EmployeesService {
  constructor(
    private readonly repository: EmployeesRepository,
    private readonly auditService: AuditService,
  ) {}

  async findAll(companyId: string, query: PaginationQueryDto) {
    const { items, total, page, limit } = await this.repository.findManyByCompany(
      companyId,
      query,
    );
    return serialize(toPaginatedResult(items.map((item) => this.toPayload(item)), total, page, limit));
  }

  async findOne(id: string, companyId: string) {
    const employee = await this.repository.findById(id, companyId);
    if (!employee) throw new NotFoundException('Employee');
    return serialize(this.toPayload(employee));
  }

  async create(companyId: string, dto: CreateEmployeeDto, actorId: string) {
    const code = dto.employeeCode.trim();
    const existing = await this.repository.findByCode(companyId, code);
    if (existing) throw new ConflictException('Employee code already exists');

    await this.assertOrgRefs(companyId, dto);

    const employee = await this.repository.create(
      companyId,
      {
        employeeCode: code,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        mobile: dto.mobile,
        branchId: dto.branchId,
        departmentId: dto.departmentId,
        designationId: dto.designationId,
        reportingManagerId: dto.reportingManagerId,
        joiningDate: dto.joiningDate,
        employmentType: dto.employmentType ?? null,
        employmentStatus: dto.employmentStatus ?? 'active',
      },
      actorId,
    );

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'Employee',
      entityId: employee.employeeId.toString(),
      newValue: { employeeCode: code, firstName: employee.firstName },
    });

    return serialize(this.toPayload(employee));
  }

  async update(id: string, companyId: string, dto: UpdateEmployeeDto, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw new NotFoundException('Employee');

    await this.assertOrgRefs(companyId, dto);

    if (dto.reportingManagerId && dto.reportingManagerId === id) {
      throw new ConflictException('Employee cannot be their own reporting manager');
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
    if (!existing) throw new NotFoundException('Employee');

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
    const {
      companyId,
      userId,
      actorId,
      employeeRecordId,
      employeeCode,
      firstName,
      lastName,
      email,
      mobile,
    } = params;

    if (employeeRecordId) {
      const employee = await this.repository.findById(employeeRecordId, companyId);
      if (!employee) {
        throw new BusinessException('employeeRecordId must belong to this company', HttpStatus.BAD_REQUEST, [
          { field: 'employeeRecordId', message: 'Invalid employee for company' },
        ]);
      }
      if (employee.userId && employee.userId.toString() !== userId) {
        throw new ConflictException('Employee is already linked to another user');
      }
      if (!employee.userId) {
        await this.repository.linkUser(employeeRecordId, userId, actorId);
      }
      return employee;
    }

    const code = employeeCode?.trim();
    if (!code) return null;

    const existing = await this.repository.findByCode(companyId, code);
    if (existing) {
      if (existing.userId && existing.userId.toString() !== userId) {
        throw new ConflictException('Employee code is already linked to another user');
      }
      if (!existing.userId) {
        await this.repository.linkUser(existing.employeeId.toString(), userId, actorId);
      }
      return existing;
    }

    const linked = await this.repository.findByUserId(companyId, userId);
    if (linked) return linked;

    return this.repository.create(
      companyId,
      {
        employeeCode: code,
        firstName,
        lastName: lastName ?? '',
        email: email ?? null,
        mobile: mobile ?? null,
        employmentStatus: 'active',
        userId,
      },
      actorId,
    );
  }

  private async assertOrgRefs(
    companyId: string,
    dto: {
      branchId?: string | null;
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
        throw new BusinessException(
          'reportingManagerId must belong to this company',
          HttpStatus.BAD_REQUEST,
          [{ field: 'reportingManagerId', message: 'Invalid id for company' }],
        );
      }
    }
  }

  private toPayload(employee: {
    employeeId: bigint;
    companyId: bigint;
    userId: bigint | null;
    employeeCode: string;
    firstName: string;
    lastName: string | null;
    email: string | null;
    mobile: string | null;
    branchId: bigint | null;
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
    reportingManager?: {
      employeeId: bigint;
      employeeCode: string;
      firstName: string;
      lastName: string | null;
    } | null;
  }) {
    return {
      employeeId: employee.employeeId.toString(),
      companyId: employee.companyId.toString(),
      userId: employee.userId?.toString() ?? null,
      employeeCode: employee.employeeCode,
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: employee.email,
      mobile: employee.mobile,
      branchId: employee.branchId?.toString() ?? null,
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
      reportingManager: employee.reportingManager
        ? {
            employeeId: employee.reportingManager.employeeId.toString(),
            employeeCode: employee.reportingManager.employeeCode,
            firstName: employee.reportingManager.firstName,
            lastName: employee.reportingManager.lastName,
          }
        : null,
    };
  }
}
