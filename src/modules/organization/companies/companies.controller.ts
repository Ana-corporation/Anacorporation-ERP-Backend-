import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions, TenantOptional } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ForbiddenException } from '@/common/exceptions/business.exception';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto, UpdateCompanyDto, UpdateCompanyStatusDto } from './dto/company.dto';

@ApiTags('Companies')
@ApiBearerAuth()
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get()
  @RequirePermissions('companies:view')
  @ApiOperation({ summary: 'List companies (platform tenant catalogue)' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.companiesService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('companies:view')
  @ApiOperation({ summary: 'Get company by ID' })
  findOne(@Param('id') id: string) {
    return this.companiesService.findOne(id);
  }

  @Post()
  @TenantOptional()
  @RequirePermissions('companies:create')
  @ApiOperation({ summary: 'Create company' })
  create(@Body() dto: CreateCompanyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.companiesService.create(dto, user?.sub);
  }

  @Patch(':id/status')
  @TenantOptional()
  @RequirePermissions('companies:edit')
  @ApiOperation({ summary: 'Set company status' })
  async setStatus(
    @Param('id') id: string,
    @Body() dto: UpdateCompanyStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const canEditAnyCompany = Boolean(user?.permissions?.includes('platform_companies:edit'));
    if (!canEditAnyCompany) {
      if (!user?.companyId || user.companyId.toString() !== id.toString()) {
        throw new ForbiddenException('Company context mismatch');
      }
    }

    return this.companiesService.setStatus(id, dto.status, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('companies:edit')
  @ApiOperation({ summary: 'Update company' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCompanyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.companiesService.update(id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('companies:delete')
  @ApiOperation({ summary: 'Delete company' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.companiesService.remove(id, user.sub);
  }
}
