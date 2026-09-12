import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/iam/authentication/auth.module';
import { UserPreferencesModule } from '@/modules/iam/user-preferences/user-preferences.module';
import { EmployeesModule } from '@/modules/organization/employees/employees.module';
import { CompanyAdminsController } from './company-admins.controller';
import { CompanyUsersController } from './company-users.controller';
import { UsersController } from './users.controller';
import { UsersMeController } from './users-me.controller';
import { UsersMeService } from './users-me.service';
import { UsersRepository } from './users.repository';
import { CompanyUsersRepository } from './company-users.repository';
import { UsersService } from './users.service';
import { CompanyUsersService } from './company-users.service';

@Module({
  imports: [AuthModule, EmployeesModule, UserPreferencesModule],
  controllers: [UsersMeController, UsersController, CompanyUsersController, CompanyAdminsController],
  providers: [
    UsersRepository,
    UsersService,
    UsersMeService,
    CompanyUsersRepository,
    CompanyUsersService,
  ],
  exports: [UsersService, UsersRepository, CompanyUsersService, CompanyUsersRepository],
})
export class UsersModule {}
