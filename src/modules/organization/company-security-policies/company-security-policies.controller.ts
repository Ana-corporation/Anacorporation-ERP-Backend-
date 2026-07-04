import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { CreateCompanySecurityPolicyDto, UpdateCompanySecurityPolicyDto } from './dto/company-security-policy.dto';
import { CompanySecurityPoliciesService } from './company-security-policies.service';

@ApiTags('Company Security Policies')
@ApiBearerAuth()
@Controller('companies/:companyId/security-policies')
export class CompanySecurityPoliciesController {
  constructor(private readonly companySecurityPoliciesService: CompanySecurityPoliciesService) {}

  @Get()
  @RequirePermissions('company_security_policies:view')
  @ApiOperation({ summary: 'List security policies for company' })
  findAll(@Param('companyId') companyId: string, @Query() query: PaginationQueryDto) {
    return this.companySecurityPoliciesService.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('company_security_policies:view')
  @ApiOperation({ summary: 'Get company security policy by ID' })
  findOne(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.companySecurityPoliciesService.findOne(id, companyId);
  }

  @Post()
  @RequirePermissions('company_security_policies:create')
  @ApiOperation({ summary: 'Create company security policy' })
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateCompanySecurityPolicyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.companySecurityPoliciesService.create(companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('company_security_policies:edit')
  @ApiOperation({ summary: 'Update company security policy' })
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCompanySecurityPolicyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.companySecurityPoliciesService.update(id, companyId, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('company_security_policies:delete')
  @ApiOperation({ summary: 'Delete company security policy' })
  remove(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.companySecurityPoliciesService.remove(id, companyId, user.sub);
  }
}
