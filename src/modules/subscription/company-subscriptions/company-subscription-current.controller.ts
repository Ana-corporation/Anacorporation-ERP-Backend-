import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { serialize } from '@/common/utils/bigint.util';
import { EntitlementService } from '@/modules/subscription/entitlements/entitlement.service';
import {
  AssignCompanySubscriptionDto,
  CancelCompanySubscriptionDto,
  PatchCurrentSubscriptionDto,
} from './dto/company-subscription.dto';
import { CompanySubscriptionsService } from './company-subscriptions.service';

/** FE singular subscription routes (alongside plural /subscriptions CRUD). */
@ApiTags('Company Subscription')
@ApiBearerAuth()
@Controller('companies/:companyId/subscription')
export class CompanySubscriptionCurrentController {
  constructor(
    private readonly companySubscriptionsService: CompanySubscriptionsService,
    private readonly entitlementService: EntitlementService,
  ) {}

  @Get()
  @RequirePermissions('company_subscriptions:view')
  @ApiOperation({ summary: 'Get current live company subscription' })
  findCurrent(
    @Param('companyId') companyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.companySubscriptionsService.findCurrent(companyId);
  }

  @Get('modules')
  @RequirePermissions('company_modules:view')
  @ApiOperation({ summary: 'Effective module entitlements for company (subscription view)' })
  async getSubscriptionModules(
    @Param('companyId') companyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    const snapshot = await this.entitlementService.getEffectiveEntitlements(companyId);
    return serialize({
      subscription: snapshot.subscription,
      modules: snapshot.modules,
    });
  }

  @Post()
  @RequirePermissions('company_subscriptions:create')
  @ApiOperation({ summary: 'Assign or replace company subscription' })
  assign(
    @Param('companyId') companyId: string,
    @Body() dto: AssignCompanySubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.companySubscriptionsService.assignOrReplace(companyId, dto, user.sub);
  }

  @Post('cancel')
  @RequirePermissions('company_subscriptions:edit')
  @ApiOperation({ summary: 'Cancel current company subscription' })
  cancel(
    @Param('companyId') companyId: string,
    @Body() dto: CancelCompanySubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.companySubscriptionsService.cancelCurrent(companyId, user.sub, dto.reason);
  }

  @Patch()
  @RequirePermissions('company_subscriptions:edit')
  @ApiOperation({ summary: 'Update current subscription (cancel at period end, plan, renew)' })
  patchCurrent(
    @Param('companyId') companyId: string,
    @Body() dto: PatchCurrentSubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.companySubscriptionsService.patchCurrent(companyId, dto, user.sub);
  }
}
