import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/iam/authentication/auth.module';
import { EmployeesModule } from '@/modules/organization/employees/employees.module';
import { CompanyUsersController } from './company-users.controller';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule, EmployeesModule],
  controllers: [UsersController, CompanyUsersController],
  providers: [UsersRepository, UsersService],
  exports: [UsersService, UsersRepository],
})
export class UsersModule {}
