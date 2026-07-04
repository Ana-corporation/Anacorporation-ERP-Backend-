import { Module } from '@nestjs/common';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysRepository } from './api-keys.repository';
import { ApiKeysService } from './api-keys.service';

@Module({
  controllers: [ApiKeysController],
  providers: [ApiKeysRepository, ApiKeysService],
  exports: [ApiKeysService, ApiKeysRepository],
})
export class ApiKeysModule {}
