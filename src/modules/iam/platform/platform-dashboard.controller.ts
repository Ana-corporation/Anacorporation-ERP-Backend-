import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { PlatformDashboardService } from './platform-dashboard.service';

@ApiTags('Platform')
@ApiBearerAuth()
@Controller('platform')
export class PlatformDashboardController {
  constructor(private readonly platformDashboard: PlatformDashboardService) {}

  @Get('dashboard')
  @RequirePermissions('platform_companies:view')
  @ApiOperation({ summary: 'Platform overview dashboard aggregate' })
  getDashboard() {
    return this.platformDashboard.getDashboardStats();
  }

  @Get('subscriptions')
  @RequirePermissions('platform_companies:view')
  @ApiOperation({ summary: 'Cross-tenant subscriptions list for platform admin' })
  listSubscriptions(@Query('limit') limit?: string) {
    const parsed = Number(limit);
    const safeLimit = Number.isFinite(parsed) ? parsed : 200;
    return this.platformDashboard.listSubscriptions(Math.min(200, Math.max(1, safeLimit)));
  }
}

