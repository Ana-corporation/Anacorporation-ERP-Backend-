import { Global, Module } from '@nestjs/common';
import { StorageProvider } from './storage-provider.interface';
import { GcsStorageProvider } from './gcs-storage.provider';
import { StorageService, storageProviderFactory } from './storage.service';

@Global()
@Module({
  providers: [GcsStorageProvider, storageProviderFactory, StorageService],
  exports: [StorageService, StorageProvider],
})
export class StorageModule {}
