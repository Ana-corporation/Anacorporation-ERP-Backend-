import { Module } from '@nestjs/common';
import { VendorsController } from './vendors.controller';
import { VendorsRepository, VendorsService } from './vendors.service';

@Module({
  controllers: [VendorsController],
  providers: [VendorsRepository, VendorsService],
  exports: [VendorsService],
})
export class VendorsModule {}
