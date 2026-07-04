import { Module } from '@nestjs/common';
import { UserPreferencesController } from './user-preferences.controller';
import { UserPreferencesRepository } from './user-preferences.repository';
import { UserPreferencesService } from './user-preferences.service';

@Module({
  controllers: [UserPreferencesController],
  providers: [UserPreferencesRepository, UserPreferencesService],
  exports: [UserPreferencesService, UserPreferencesRepository],
})
export class UserPreferencesModule {}
