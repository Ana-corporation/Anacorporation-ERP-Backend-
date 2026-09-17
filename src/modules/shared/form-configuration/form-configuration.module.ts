import { Module, forwardRef } from '@nestjs/common';
import { FormConfigurationController } from './form-configuration.controller';
import { FormConfigurationRepository } from './form-configuration.repository';
import { FormConfigurationService } from './form-configuration.service';
import { FormSchemaService } from './form-schema.service';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { TabAccessModule } from '../tab-access/tab-access.module';

@Module({
  imports: [forwardRef(() => CustomFieldsModule), TabAccessModule],
  controllers: [FormConfigurationController],
  providers: [FormConfigurationRepository, FormConfigurationService, FormSchemaService],
  exports: [FormConfigurationService, FormSchemaService],
})
export class FormConfigurationModule {}
