import { Module } from '@nestjs/common';
import { UserModuleAccessController } from './user-module-access.controller';
import { UserModuleAccessRepository } from './user-module-access.repository';
import { UserModuleAccessService } from './user-module-access.service';

@Module({
  controllers: [UserModuleAccessController],
  providers: [UserModuleAccessRepository, UserModuleAccessService],
  exports: [UserModuleAccessService, UserModuleAccessRepository],
})
export class UserModuleAccessModule {}
