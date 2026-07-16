import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { CompanyUsersController } from './company-users.controller';
import { UsersRepository } from './users.repository';
import { CompanyUsersRepository } from './company-users.repository';
import { UsersService } from './users.service';
import { CompanyUsersService } from './company-users.service';

@Module({
  controllers: [UsersController, CompanyUsersController],
  providers: [UsersRepository, UsersService, CompanyUsersRepository, CompanyUsersService],
  exports: [UsersService, UsersRepository, CompanyUsersService, CompanyUsersRepository],
})
export class UsersModule {}
