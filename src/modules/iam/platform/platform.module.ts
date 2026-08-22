import { Module } from '@nestjs/common';
import { PlatformCompaniesController } from './platform-companies.controller';
import { PlatformCompaniesRepository } from './platform-companies.repository';
import { PlatformCompaniesService } from './platform-companies.service';
import { PlatformDashboardController } from './platform-dashboard.controller';
import { PlatformDashboardService } from './platform-dashboard.service';

@Module({
  controllers: [PlatformCompaniesController, PlatformDashboardController],
  providers: [PlatformCompaniesRepository, PlatformCompaniesService, PlatformDashboardService],
})
export class PlatformModule {}
