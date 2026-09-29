import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { UpdateTabAccessDto, UpdateTabRegistrationDto } from './dto/tab-access.dto';
import { TabAccessService } from './tab-access.service';

@ApiTags('Tab Access')
@ApiBearerAuth()
@Controller('companies/:companyId/entities/:entityType/tabs')
export class TabAccessController {
  constructor(private readonly tabAccessService: TabAccessService) {}

  @Get()
  @RequirePermissions('tab_access:view')
  @ApiOperation({
    summary: 'Get available entity tabs and which roles can see each tab',
  })
  getTabs(
    @Param('companyId') companyId: string,
    @Param('entityType') entityType: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.tabAccessService.getEntityTabs(companyId, entityType);
  }

  @Put(':tabKey/access')
  @RequirePermissions('tab_access:edit')
  @ApiOperation({
    summary: 'Set which roles can see a tab (allow-list). Does not change RBAC permissions.',
  })
  updateTabAccess(
    @Param('companyId') companyId: string,
    @Param('entityType') entityType: string,
    @Param('tabKey') tabKey: string,
    @Body() dto: UpdateTabAccessDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.tabAccessService.updateTabAccess(companyId, entityType, tabKey, dto);
  }

  @Put(':tabKey/registration')
  @RequirePermissions('tab_access:edit')
  @ApiOperation({
    summary: 'Show or hide a tab on the public vendor registration form (company-level, not per role).',
  })
  updateTabRegistration(
    @Param('companyId') companyId: string,
    @Param('entityType') entityType: string,
    @Param('tabKey') tabKey: string,
    @Body() dto: UpdateTabRegistrationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.tabAccessService.updateTabRegistration(companyId, entityType, tabKey, dto);
  }
}
