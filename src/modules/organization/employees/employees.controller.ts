import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { CreateEmployeeDto, EmployeeLookupQueryDto, UpdateEmployeeDto } from './dto/employee.dto';
import { EmployeesService } from './employees.service';

@ApiTags('Employees')
@ApiBearerAuth()
@Controller('companies/:companyId/employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get()
  @RequirePermissions('employees:view')
  @ApiOperation({ summary: 'List employees for company (ERP master)' })
  findAll(
    @Param('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.employeesService.findAll(companyId, query);
  }

  @Get('lookup')
  @RequirePermissions('employees:view')
  @ApiOperation({
    summary: 'Light list for ERP dropdowns (salesperson, store-keeper, approver). No sensitive fields.',
  })
  lookup(
    @Param('companyId') companyId: string,
    @Query() query: EmployeeLookupQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.employeesService.lookup(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('employees:view')
  @ApiOperation({ summary: 'Get employee by ID' })
  findOne(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.employeesService.findOne(id, companyId);
  }

  @Post()
  @RequirePermissions('employees:create')
  @ApiOperation({ summary: 'Create employee (code from EMPLOYEE number series when omitted; no login until invited)' })
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateEmployeeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.employeesService.create(companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('employees:edit')
  @ApiOperation({ summary: 'Update employee org/profile fields' })
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.employeesService.update(id, companyId, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('employees:delete')
  @ApiOperation({ summary: 'Soft-delete employee' })
  remove(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.employeesService.remove(id, companyId, user.sub);
  }
}
