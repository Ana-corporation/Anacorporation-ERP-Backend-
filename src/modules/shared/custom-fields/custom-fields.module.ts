import { Module, forwardRef } from '@nestjs/common';
import { CustomFieldsDefinitionsController } from './custom-fields-definitions.controller';
import { CustomFieldsMetaController } from './custom-fields-meta.controller';
import { CustomFieldsRepository } from './custom-fields.repository';
import {
  CustomFieldsDefinitionsService,
  CustomFieldsValuesService,
} from './custom-fields.service';
import { CustomFieldsValidationService } from './custom-fields-validation.service';
import { FormSchemaController } from './form-schema.controller';
import { FormConfigurationModule } from '../form-configuration/form-configuration.module';

@Module({
  imports: [forwardRef(() => FormConfigurationModule)],
  controllers: [
    CustomFieldsDefinitionsController,
    CustomFieldsMetaController,
    FormSchemaController,
  ],
  providers: [
    CustomFieldsRepository,
    CustomFieldsValidationService,
    CustomFieldsDefinitionsService,
    CustomFieldsValuesService,
  ],
  exports: [
    CustomFieldsValuesService,
    CustomFieldsDefinitionsService,
    CustomFieldsRepository,
    CustomFieldsValidationService,
  ],
})
export class CustomFieldsModule {}
