import { Module } from '@nestjs/common';
import { VendorsController } from './vendors.controller';
import { VendorsRepository } from './vendors.repository';
import { VendorsService } from './vendors.service';

@Module({
  controllers: [VendorsController],
  providers: [VendorsRepository, VendorsService],
  exports: [VendorsService],
})
export class VendorsModule {}
