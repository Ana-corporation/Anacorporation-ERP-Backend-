import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import {
  AssignUserDataAccessPolicyDto,
  CreateDataAccessPolicyDto,
  SetUserDataAccessPoliciesDto,
  UpdateDataAccessPolicyDto,
} from './dto/data-access-policy.dto';
import { DataAccessPoliciesService } from './data-access-policies.service';

@ApiTags('Data Access Policies')
@ApiBearerAuth()
@Controller('companies/:companyId')
export class DataAccessPoliciesController {
  constructor(private readonly dataAccessPoliciesService: DataAccessPoliciesService) {}

  @Get('data-access-policies')
  @RequirePermissions('data_access_policies:view')
  @ApiOperation({ summary: 'List company data access policies' })
  findAll(
    @Param('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.dataAccessPoliciesService.findAll(companyId, query);
  }

  @Post('data-access-policies')
  @RequirePermissions('data_access_policies:create')
  @ApiOperation({ summary: 'Create data access policy (WHERE scope only)' })
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateDataAccessPolicyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.dataAccessPoliciesService.create(companyId, dto, user.sub);
  }

  @Get('data-access-policies/:id')
  @RequirePermissions('data_access_policies:view')
  @ApiOperation({ summary: 'Get data access policy' })
  findOne(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.dataAccessPoliciesService.findOne(id, companyId);
  }

  @Patch('data-access-policies/:id')
  @RequirePermissions('data_access_policies:edit')
  @ApiOperation({ summary: 'Update data access policy' })
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDataAccessPolicyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.dataAccessPoliciesService.update(id, companyId, dto, user.sub);
  }

  @Delete('data-access-policies/:id')
  @RequirePermissions('data_access_policies:delete')
  @ApiOperation({ summary: 'Soft-delete data access policy' })
  remove(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.dataAccessPoliciesService.remove(id, companyId, user.sub);
  }

  @Get('users/:userId/data-access-policies')
  @RequirePermissions('data_access_policies:view')
  @ApiOperation({ summary: 'List data access policies assigned to a user' })
  getUserPolicies(
    @Param('companyId') companyId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.dataAccessPoliciesService.getUserDataAccessPolicies(companyId, userId);
  }

  @Post('users/:userId/data-access-policies')
  @RequirePermissions('data_access_policies:edit')
  @ApiOperation({ summary: 'Assign one data access policy to a user' })
  assignUserPolicy(
    @Param('companyId') companyId: string,
    @Param('userId') userId: string,
    @Body() dto: AssignUserDataAccessPolicyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.dataAccessPoliciesService.assignUserDataAccessPolicy(
      companyId,
      userId,
      dto,
      user.sub,
    );
  }

  @Delete('users/:userId/data-access-policies/:policyId')
  @RequirePermissions('data_access_policies:edit')
  @ApiOperation({ summary: 'Remove one data access policy from a user' })
  removeUserPolicy(
    @Param('companyId') companyId: string,
    @Param('userId') userId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.dataAccessPoliciesService.removeUserDataAccessPolicy(
      companyId,
      userId,
      policyId,
      user.sub,
    );
  }

  @Put('users/:userId/data-access-policies')
  @RequirePermissions('data_access_policies:edit')
  @ApiOperation({
    summary: 'Replace all user data access policies (legacy FE drawer; prefer POST/DELETE)',
  })
  setUserPolicies(
    @Param('companyId') companyId: string,
    @Param('userId') userId: string,
    @Body() dto: SetUserDataAccessPoliciesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.dataAccessPoliciesService.setUserDataAccessPolicies(
      companyId,
      userId,
      dto,
      user.sub,
    );
  }
}
