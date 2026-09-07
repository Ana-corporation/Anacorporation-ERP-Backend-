import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { serialize } from '@/common/utils/bigint.util';
import { CompanyModuleOverridesService } from './company-module-overrides.service';
import { CreateModuleOverrideDto, UpdateModuleOverrideDto, UpsertModuleAccessDto } from './dto/entitlement.dto';
import { EntitlementService } from './entitlement.service';

@ApiTags('Company Entitlements')
@ApiBearerAuth()
@Controller('companies/:companyId')
export class EntitlementsController {
  constructor(
    private readonly entitlementService: EntitlementService,
    private readonly overridesService: CompanyModuleOverridesService,
  ) {}

  @Get('effective-entitlements')
  @RequirePermissions('company_modules:view')
  @ApiOperation({ summary: 'Effective module entitlements for company' })
  async getEffectiveEntitlements(
    @Param('companyId') companyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return serialize(await this.entitlementService.getEffectiveEntitlements(companyId));
  }

  @Get('module-overrides')
  @RequirePermissions('company_subscriptions:view')
  @ApiOperation({ summary: 'List commercial module overrides' })
  findOverrides(
    @Param('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.overridesService.findAll(companyId, query);
  }

  @Post('module-overrides')
  @RequirePermissions('company_subscriptions:edit')
  @ApiOperation({ summary: 'Create commercial module override (GRANT/REVOKE)' })
  createOverride(
    @Param('companyId') companyId: string,
    @Body() dto: CreateModuleOverrideDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.overridesService.create(companyId, dto, user.sub);
  }

  @Put('module-access/:moduleCode')
  @RequirePermissions('company_subscriptions:edit')
  @ApiOperation({ summary: 'Upsert company module access override by module code' })
  upsertModuleAccess(
    @Param('companyId') companyId: string,
    @Param('moduleCode') moduleCode: string,
    @Body() dto: UpsertModuleAccessDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.overridesService.upsertByModuleCode(companyId, moduleCode, dto, user.sub);
  }

  @Patch('module-overrides/:overrideId')
  @RequirePermissions('company_subscriptions:edit')
  @ApiOperation({ summary: 'Update override reason or expiry' })
  updateOverride(
    @Param('companyId') companyId: string,
    @Param('overrideId') overrideId: string,
    @Body() dto: UpdateModuleOverrideDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.overridesService.update(companyId, overrideId, dto, user.sub);
  }

  @Delete('module-overrides/:overrideId')
  @RequirePermissions('company_subscriptions:edit')
  @ApiOperation({ summary: 'Remove commercial module override' })
  removeOverride(
    @Param('companyId') companyId: string,
    @Param('overrideId') overrideId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.overridesService.remove(companyId, overrideId, user.sub);
  }
}
