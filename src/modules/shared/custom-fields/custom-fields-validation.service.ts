import { Injectable, HttpStatus } from '@nestjs/common';
import { CustomFieldDefinition, Prisma } from '@prisma/client';
import { BusinessException } from '@/common/exceptions/business.exception';
import {
  CustomFieldEntityType,
  CustomFieldOption,
  CustomFieldType,
  CustomFieldValidationRules,
} from './custom-fields.constants';
import { CustomFieldValueColumns } from './custom-fields.repository';

export interface ValidatedCustomFields {
  values: Map<string, { fieldId: bigint; columns: CustomFieldValueColumns; apiValue: unknown }>;
  /** Field IDs to delete (PATCH clear via null / empty string). */
  clearFieldIds: bigint[];
  apiMap: Record<string, unknown>;
}

@Injectable()
export class CustomFieldsValidationService {
  validateAndNormalize(
    definitions: CustomFieldDefinition[],
    customFields: Record<string, unknown> | undefined,
    mode: 'create' | 'update',
  ): ValidatedCustomFields {
    const activeDefs = definitions.filter((d) => d.isActive && !d.deletedAt);
    const defByName = new Map(activeDefs.map((d) => [d.fieldName, d]));
    const input = customFields ?? {};

    if (mode === 'update' && customFields === undefined) {
      return { values: new Map(), clearFieldIds: [], apiMap: {} };
    }

    for (const key of Object.keys(input)) {
      if (!defByName.has(key)) {
        throw new BusinessException(`Unknown custom field: ${key}`, HttpStatus.BAD_REQUEST, [
          { field: `customFields.${key}`, message: `Unknown custom field: ${key}` },
        ]);
      }
    }

    const values = new Map<
      string,
      { fieldId: bigint; columns: CustomFieldValueColumns; apiValue: unknown }
    >();
    const clearFieldIds: bigint[] = [];
    const apiMap: Record<string, unknown> = {};

    for (const def of activeDefs) {
      const fieldPath = `customFields.${def.fieldName}`;
      const hasInput = Object.prototype.hasOwnProperty.call(input, def.fieldName);
      let rawValue: unknown;

      if (hasInput) {
        rawValue = input[def.fieldName];
      } else if (mode === 'create') {
        rawValue = def.defaultValue ?? undefined;
      } else {
        // update: omitted key → leave existing value (do not re-check required)
        continue;
      }

      // Explicit clear on update: null or "" (non-checkbox)
      if (
        mode === 'update' &&
        hasInput &&
        (rawValue === null || (rawValue === '' && def.fieldType !== 'checkbox'))
      ) {
        if (def.isRequired) {
          throw new BusinessException(`Custom field "${def.displayName}" is required`, HttpStatus.BAD_REQUEST, [
            { field: fieldPath, message: `Custom field "${def.displayName}" is required` },
          ]);
        }
        clearFieldIds.push(def.fieldId);
        apiMap[def.fieldName] = null;
        continue;
      }

      if (this.isEmpty(rawValue)) {
        if (def.isRequired && (mode === 'create' || hasInput)) {
          throw new BusinessException(`Custom field "${def.displayName}" is required`, HttpStatus.BAD_REQUEST, [
            { field: fieldPath, message: `Custom field "${def.displayName}" is required` },
          ]);
        }
        if (mode === 'create' && !hasInput) {
          continue;
        }
        if (!hasInput) continue;
      }

      try {
        const normalized = this.coerceValue(def, rawValue);
        const columns = this.toColumns(def.fieldType as CustomFieldType, normalized);
        values.set(def.fieldName, {
          fieldId: def.fieldId,
          columns,
          apiValue: normalized,
        });
        apiMap[def.fieldName] = normalized;
      } catch (error) {
        if (error instanceof BusinessException) {
          const msg =
            typeof error.getResponse() === 'object' && error.getResponse() !== null
              ? String((error.getResponse() as { message?: string }).message ?? error.message)
              : error.message;
          throw new BusinessException(msg, HttpStatus.BAD_REQUEST, [{ field: fieldPath, message: msg }]);
        }
        throw error;
      }
    }

    if (mode === 'create') {
      for (const def of activeDefs) {
        if (!def.isRequired || values.has(def.fieldName)) continue;
        const fieldPath = `customFields.${def.fieldName}`;
        if (def.defaultValue !== null && def.defaultValue !== undefined) {
          const normalized = this.coerceValue(def, def.defaultValue);
          const columns = this.toColumns(def.fieldType as CustomFieldType, normalized);
          values.set(def.fieldName, {
            fieldId: def.fieldId,
            columns,
            apiValue: normalized,
          });
          apiMap[def.fieldName] = normalized;
        } else {
          throw new BusinessException(`Custom field "${def.displayName}" is required`, HttpStatus.BAD_REQUEST, [
            { field: fieldPath, message: `Custom field "${def.displayName}" is required` },
          ]);
        }
      }
    }

    return { values, clearFieldIds, apiMap };
  }

  decodeValue(def: CustomFieldDefinition, row: CustomFieldValueColumns): unknown {
    switch (def.fieldType as CustomFieldType) {
      case 'checkbox':
        return row.valueBool ?? false;
      case 'number':
      case 'decimal':
        return row.valueNumber !== null ? Number(row.valueNumber) : null;
      case 'date':
        return row.valueDate ? row.valueDate.toISOString().slice(0, 10) : null;
      default:
        return row.valueText;
    }
  }

  /**
   * Build API map from stored value rows.
   * Includes inactive/soft-deleted definitions so historical Vendor values remain visible on read.
   * (Form-schema / create-edit still use active definitions only.)
   */
  buildApiMapFromRows(
    _definitions: CustomFieldDefinition[],
    rows: Array<{ field: CustomFieldDefinition } & CustomFieldValueColumns>,
  ): Record<string, unknown> {
    const map: Record<string, unknown> = {};
    for (const row of rows) {
      const def = row.field;
      if (!def) continue;
      map[def.fieldName] = this.decodeValue(def, row);
    }
    return map;
  }

  toFormSchemaField(def: CustomFieldDefinition) {
    return {
      fieldId: def.fieldId.toString(),
      fieldName: def.fieldName,
      displayName: def.displayName,
      fieldType: def.fieldType,
      sectionKey: def.sectionKey ?? 'custom',
      isRequired: def.isRequired,
      defaultValue: def.defaultValue ?? null,
      validation: def.validation ?? null,
      options: def.options ?? null,
      placeholder: def.placeholder ?? null,
      helpText: def.helpText ?? null,
      sortOrder: def.sortOrder,
      isFilterable: def.isFilterable,
      isReadOnly: def.isReadOnly,
      isHidden: def.isHidden,
    };
  }

  /**
   * Validate a definition's defaultValue against fieldType / options / validation rules.
   * Empty default is allowed (means no auto-fill).
   */
  assertDefaultValue(
    displayName: string,
    fieldType: CustomFieldType,
    defaultValue: unknown,
    validation: unknown,
    options: CustomFieldOption[] | null | undefined,
  ) {
    if (defaultValue === null || defaultValue === undefined || defaultValue === '') return;
    const fakeDef = {
      displayName,
      fieldType,
      validation: validation ?? null,
      options: options ?? null,
    } as CustomFieldDefinition;
    try {
      this.coerceValue(fakeDef, defaultValue);
    } catch (error) {
      if (error instanceof BusinessException) {
        const msg =
          typeof error.getResponse() === 'object' && error.getResponse() !== null
            ? String((error.getResponse() as { message?: string }).message ?? error.message)
            : error.message;
        throw new BusinessException(`Invalid defaultValue: ${msg}`, HttpStatus.BAD_REQUEST, [
          { field: 'defaultValue', message: msg },
        ]);
      }
      throw error;
    }
  }

  private isEmpty(value: unknown): boolean {
    return value === null || value === undefined || value === '';
  }

  private coerceValue(def: CustomFieldDefinition, raw: unknown): unknown {
    const rules = (def.validation ?? {}) as CustomFieldValidationRules;
    const fieldType = def.fieldType as CustomFieldType;

    switch (fieldType) {
      case 'checkbox': {
        if (typeof raw === 'boolean') return raw;
        if (raw === 'true' || raw === 1 || raw === '1') return true;
        if (raw === 'false' || raw === 0 || raw === '0') return false;
        throw new BusinessException(`"${def.displayName}" must be a boolean`);
      }
      case 'number': {
        const num = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(num) || !Number.isInteger(num)) {
          throw new BusinessException(`"${def.displayName}" must be an integer`);
        }
        this.assertNumericRules(def.displayName, num, rules);
        return num;
      }
      case 'decimal': {
        const num = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(num)) {
          throw new BusinessException(`"${def.displayName}" must be a number`);
        }
        this.assertNumericRules(def.displayName, num, rules);
        return num;
      }
      case 'date': {
        const str = String(raw).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
          throw new BusinessException(`"${def.displayName}" must be YYYY-MM-DD`);
        }
        const d = new Date(`${str}T00:00:00.000Z`);
        if (Number.isNaN(d.getTime())) {
          throw new BusinessException(`"${def.displayName}" is not a valid date`);
        }
        return str;
      }
      case 'email': {
        const str = String(raw).trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) {
          throw new BusinessException(`"${def.displayName}" must be a valid email`);
        }
        this.assertLengthRules(def.displayName, str, rules);
        return str;
      }
      case 'phone': {
        const str = String(raw).trim();
        if (str.length < 3 || str.length > 50) {
          throw new BusinessException(`"${def.displayName}" must be a valid phone number`);
        }
        return str;
      }
      case 'dropdown': {
        const str = String(raw).trim();
        const options = (def.options ?? []) as unknown as CustomFieldOption[];
        if (!options.some((o) => o.value === str)) {
          throw new BusinessException(`"${def.displayName}" has an invalid option`);
        }
        return str;
      }
      case 'textarea':
      case 'text':
      default: {
        const str = String(raw).trim();
        this.assertLengthRules(def.displayName, str, rules);
        if (rules.regex) {
          try {
            const re = new RegExp(rules.regex);
            if (!re.test(str)) {
              throw new BusinessException(`"${def.displayName}" format is invalid`);
            }
          } catch {
            throw new BusinessException(`Invalid validation regex for "${def.displayName}"`);
          }
        }
        return str;
      }
    }
  }

  private assertNumericRules(label: string, num: number, rules: CustomFieldValidationRules) {
    if (rules.min !== undefined && num < rules.min) {
      throw new BusinessException(`"${label}" must be >= ${rules.min}`);
    }
    if (rules.max !== undefined && num > rules.max) {
      throw new BusinessException(`"${label}" must be <= ${rules.max}`);
    }
  }

  private assertLengthRules(label: string, str: string, rules: CustomFieldValidationRules) {
    if (rules.minLength !== undefined && str.length < rules.minLength) {
      throw new BusinessException(`"${label}" must be at least ${rules.minLength} characters`);
    }
    if (rules.maxLength !== undefined && str.length > rules.maxLength) {
      throw new BusinessException(`"${label}" must be at most ${rules.maxLength} characters`);
    }
  }

  private toColumns(fieldType: CustomFieldType, value: unknown): CustomFieldValueColumns {
    switch (fieldType) {
      case 'checkbox':
        return {
          valueText: null,
          valueNumber: null,
          valueDate: null,
          valueBool: Boolean(value),
          valueJson: null,
        };
      case 'number':
      case 'decimal':
        return {
          valueText: null,
          valueNumber: new Prisma.Decimal(String(value)),
          valueDate: null,
          valueBool: null,
          valueJson: null,
        };
      case 'date':
        return {
          valueText: null,
          valueNumber: null,
          valueDate: new Date(`${String(value)}T00:00:00.000Z`),
          valueBool: null,
          valueJson: null,
        };
      default:
        return {
          valueText: String(value),
          valueNumber: null,
          valueDate: null,
          valueBool: null,
          valueJson: null,
        };
    }
  }
}

export function assertDropdownHasOptions(
  fieldType: CustomFieldType,
  options: CustomFieldOption[] | undefined,
) {
  if (fieldType === 'dropdown' && (!options || options.length === 0)) {
    throw new BusinessException('Dropdown fields require at least one option', HttpStatus.BAD_REQUEST, [
      { field: 'options', message: 'Dropdown fields require at least one option' },
    ]);
  }
}

export function assertValidationRulesShape(validation: unknown) {
  if (validation === null || validation === undefined) return;
  if (typeof validation !== 'object' || Array.isArray(validation)) {
    throw new BusinessException('validation must be an object', HttpStatus.BAD_REQUEST, [
      { field: 'validation', message: 'validation must be an object' },
    ]);
  }
  const rules = validation as CustomFieldValidationRules;
  if (rules.min !== undefined && rules.max !== undefined && rules.min > rules.max) {
    throw new BusinessException('validation.min cannot be greater than validation.max', HttpStatus.BAD_REQUEST, [
      { field: 'validation', message: 'min cannot be greater than max' },
    ]);
  }
  if (
    rules.minLength !== undefined &&
    rules.maxLength !== undefined &&
    rules.minLength > rules.maxLength
  ) {
    throw new BusinessException(
      'validation.minLength cannot be greater than validation.maxLength',
      HttpStatus.BAD_REQUEST,
      [{ field: 'validation', message: 'minLength cannot be greater than maxLength' }],
    );
  }
  if (rules.regex) {
    try {
      // eslint-disable-next-line no-new
      new RegExp(rules.regex);
    } catch {
      throw new BusinessException('validation.regex is not a valid regular expression', HttpStatus.BAD_REQUEST, [
        { field: 'validation.regex', message: 'Invalid regular expression' },
      ]);
    }
  }
}
