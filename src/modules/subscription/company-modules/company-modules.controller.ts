import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { CreateCompanyModuleDto, UpdateCompanyModuleDto } from './dto/company-module.dto';
import { CompanyModulesService } from './company-modules.service';

@ApiTags('Company Modules')
@ApiBearerAuth()
@Controller('companies/:companyId/modules')
export class CompanyModulesController {
  constructor(private readonly companyModulesService: CompanyModulesService) {}

  @Get()
  @RequirePermissions('company_modules:view')
  @ApiOperation({ summary: 'List modules for company' })
  findAll(
    @Param('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.companyModulesService.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('company_modules:view')
  @ApiOperation({ summary: 'Get company module by ID' })
  findOne(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.companyModulesService.findOne(id, companyId);
  }

  @Post()
  @RequirePermissions('company_modules:create')
  @ApiOperation({ summary: 'Assign module to company' })
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateCompanyModuleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.companyModulesService.create(companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('company_modules:edit')
  @ApiOperation({ summary: 'Update company module' })
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCompanyModuleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.companyModulesService.update(id, companyId, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('company_modules:delete')
  @ApiOperation({ summary: 'Delete company module' })
  remove(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.companyModulesService.remove(id, companyId, user.sub);
  }
}
