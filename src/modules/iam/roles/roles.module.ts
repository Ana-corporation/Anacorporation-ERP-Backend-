import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/iam/authentication/auth.module';
import { RolesController } from './roles.controller';
import { RolesRepository } from './roles.repository';
import { RolesService } from './roles.service';

@Module({
  imports: [AuthModule],
  controllers: [RolesController],
  providers: [RolesRepository, RolesService],
  exports: [RolesService, RolesRepository],
})
export class RolesModule {}
