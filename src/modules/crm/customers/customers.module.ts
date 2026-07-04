import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersRepository, CustomersService } from './customers.service';

@Module({
  controllers: [CustomersController],
  providers: [CustomersRepository, CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
