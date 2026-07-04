import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RolesRepository } from './roles.repository';
import { RolesService } from './roles.service';

@Module({
  controllers: [RolesController],
  providers: [RolesRepository, RolesService],
  exports: [RolesService, RolesRepository],
})
export class RolesModule {}
