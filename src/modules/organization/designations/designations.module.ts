import { Module } from '@nestjs/common';
import { DesignationsController } from './designations.controller';
import { DesignationsRepository } from './designations.repository';
import { DesignationsService } from './designations.service';

@Module({
  controllers: [DesignationsController],
  providers: [DesignationsRepository, DesignationsService],
  exports: [DesignationsService, DesignationsRepository],
})
export class DesignationsModule {}
