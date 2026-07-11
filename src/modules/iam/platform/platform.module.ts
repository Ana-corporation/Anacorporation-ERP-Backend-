import { Module } from '@nestjs/common';
import { PlatformCompaniesController } from './platform-companies.controller';
import { PlatformCompaniesRepository } from './platform-companies.repository';
import { PlatformCompaniesService } from './platform-companies.service';

@Module({
  controllers: [PlatformCompaniesController],
  providers: [PlatformCompaniesRepository, PlatformCompaniesService],
})
export class PlatformModule {}
