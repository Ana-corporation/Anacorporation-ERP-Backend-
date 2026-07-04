import { Module } from '@nestjs/common';
import { UserDevicesController } from './user-devices.controller';
import { UserDevicesRepository } from './user-devices.repository';
import { UserDevicesService } from './user-devices.service';

@Module({
  controllers: [UserDevicesController],
  providers: [UserDevicesRepository, UserDevicesService],
  exports: [UserDevicesService, UserDevicesRepository],
})
export class UserDevicesModule {}
