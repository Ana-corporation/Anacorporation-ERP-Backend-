import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/iam/authentication/auth.module';
import { RolesController } from './roles.controller';
import { RolesRepository } from './roles.repository';
import { RolesService } from './roles.service';
import { SystemRoleProvisioningService } from './system-role-provisioning.service';

@Module({
  imports: [AuthModule],
  controllers: [RolesController],
  providers: [RolesRepository, RolesService, SystemRoleProvisioningService],
  exports: [RolesService, RolesRepository, SystemRoleProvisioningService],
})
export class RolesModule {}
