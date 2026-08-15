import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto';
import { DepartmentsService } from './departments.service';

@ApiTags('Departments')
@ApiBearerAuth()
@Controller('companies/:companyId/departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Get()
  @RequirePermissions('departments:view')
  @ApiOperation({ summary: 'List departments for company' })
  findAll(
    @Param('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.departmentsService.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('departments:view')
  @ApiOperation({ summary: 'Get department by ID' })
  findOne(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.departmentsService.findOne(id, companyId);
  }

  @Post()
  @RequirePermissions('departments:create')
  @ApiOperation({ summary: 'Create department' })
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateDepartmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.departmentsService.create(companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('departments:edit')
  @ApiOperation({ summary: 'Update department' })
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.departmentsService.update(id, companyId, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('departments:delete')
  @ApiOperation({ summary: 'Delete department' })
  remove(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.departmentsService.remove(id, companyId, user.sub);
  }
}
