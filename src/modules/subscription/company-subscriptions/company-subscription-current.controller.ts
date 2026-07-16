import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import {
  AssignCompanySubscriptionDto,
  CancelCompanySubscriptionDto,
} from './dto/company-subscription.dto';
import { CompanySubscriptionsService } from './company-subscriptions.service';

/** FE singular subscription routes (alongside plural /subscriptions CRUD). */
@ApiTags('Company Subscription')
@ApiBearerAuth()
@Controller('companies/:companyId/subscription')
export class CompanySubscriptionCurrentController {
  constructor(private readonly companySubscriptionsService: CompanySubscriptionsService) {}

  @Get()
  @RequirePermissions('company_subscriptions:view')
  @ApiOperation({ summary: 'Get current company subscription' })
  getCurrent(@Param('companyId') companyId: string) {
    return this.companySubscriptionsService.getCurrent(companyId);
  }

  @Post()
  @RequirePermissions('company_subscriptions:create')
  @ApiOperation({ summary: 'Assign or replace company subscription' })
  assign(
    @Param('companyId') companyId: string,
    @Body() dto: AssignCompanySubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
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
    return this.companySubscriptionsService.cancelCurrent(companyId, user.sub, dto.reason);
  }
}
