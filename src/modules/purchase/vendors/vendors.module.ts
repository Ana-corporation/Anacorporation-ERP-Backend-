import { Module } from '@nestjs/common';
import { CustomFieldsModule } from '@/modules/shared/custom-fields/custom-fields.module';
import { FormConfigurationModule } from '@/modules/shared/form-configuration/form-configuration.module';
import { ImportsModule } from '@/modules/imports/imports.module';
import { GstinModule } from '@/modules/shared/gstin/gstin.module';
import { TabAccessModule } from '@/modules/shared/tab-access/tab-access.module';
import { VendorsController } from './vendors.controller';
import { VendorImportController } from './vendor-import.controller';
import { VendorFormController } from './vendor-form/vendor-form.controller';
import {
  VendorFormInvitationController,
  VendorRegistrationInvitationController,
} from './vendor-form/vendor-form-invitation.controller';
import { VendorFormRemindersController } from './vendor-form/vendor-form-reminders.controller';
import { VendorFormInvitationRepository } from './vendor-form/vendor-form-invitation.repository';
import { VendorFormInvitationService } from './vendor-form/vendor-form-invitation.service';
import { VendorFormTokenCacheService } from './vendor-form/vendor-form-token-cache.service';
import { VendorsRepository } from './vendors.repository';
import { VendorsService } from './vendors.service';
import { VendorImportService } from './vendor-import.service';

@Module({
  imports: [CustomFieldsModule, FormConfigurationModule, ImportsModule, GstinModule, TabAccessModule],
  controllers: [
    VendorsController,
    VendorImportController,
    VendorFormInvitationController,
    VendorRegistrationInvitationController,
    VendorFormController,
    VendorFormRemindersController,
  ],
  providers: [
    VendorsRepository,
    VendorsService,
    VendorImportService,
    VendorFormInvitationRepository,
    VendorFormInvitationService,
    VendorFormTokenCacheService,
  ],
  exports: [VendorsService, VendorImportService, VendorFormInvitationService],
})
export class VendorsModule {}
