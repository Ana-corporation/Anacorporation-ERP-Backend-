import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { PlatformCompaniesService } from './platform-companies.service';
import { UpdatePlatformCompanyStatusDto } from './platform-companies.dto';

@ApiTags('Platform — Companies')
@ApiBearerAuth()
@Controller('super-admin/companies')
export class PlatformCompaniesController {
  constructor(private readonly platformCompaniesService: PlatformCompaniesService) {}

  @Get()
  @RequirePermissions('platform_companies:view')
  @ApiOperation({ summary: 'List all tenant companies (platform super admin)' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.platformCompaniesService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('platform_companies:view')
  @ApiOperation({ summary: 'Get tenant company detail with subscription summary' })
  findOne(@Param('id') id: string) {
    return this.platformCompaniesService.findOne(id);
  }

  @Patch(':id/status')
  @RequirePermissions('platform_companies:edit')
  @ApiOperation({ summary: 'Suspend, activate, or cancel a tenant company' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePlatformCompanyStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.platformCompaniesService.updateStatus(id, dto, user.sub);
  }
}
