import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { DashboardQueryDto, PurchaseSettingsDto, SaveApprovalRulesDto } from './dto/purchase.dto';
import { PurchaseSettingsService } from './purchase-settings.service';

@ApiTags('Purchase')
@ApiBearerAuth()
@Controller('companies/:companyId')
export class PurchaseSettingsController {
  constructor(private readonly settings: PurchaseSettingsService) {}

  @Get('purchase/dashboard')
  @RequirePermissions('items:view')
  dashboard(
    @Param('companyId') companyId: string,
    @Query() query: DashboardQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.settings.dashboard(companyId, query);
  }

  @Get('purchase-settings')
  @RequirePermissions('items:view')
  getSettings(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.settings.getSettings(companyId);
  }

  @Put('purchase-settings')
  @RequirePermissions('items:edit')
  saveSettings(
    @Param('companyId') companyId: string,
    @Body() dto: PurchaseSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.settings.saveSettings(companyId, dto, user.sub);
  }

  @Get('purchase-approval-rules')
  @RequirePermissions('items:view')
  getRules(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.settings.getRules(companyId);
  }

  @Put('purchase-approval-rules')
  @RequirePermissions('items:edit')
  saveRules(
    @Param('companyId') companyId: string,
    @Body() dto: SaveApprovalRulesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.settings.saveRules(companyId, dto, user.sub);
  }
}
