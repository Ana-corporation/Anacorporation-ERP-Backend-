import { Module } from '@nestjs/common';
import { PermissionSetsController } from './permission-sets.controller';
import { PermissionSetsRepository } from './permission-sets.repository';
import { PermissionSetsService } from './permission-sets.service';

@Module({
  controllers: [PermissionSetsController],
  providers: [PermissionSetsRepository, PermissionSetsService],
  exports: [PermissionSetsRepository, PermissionSetsService],
})
export class PermissionSetsModule {}
