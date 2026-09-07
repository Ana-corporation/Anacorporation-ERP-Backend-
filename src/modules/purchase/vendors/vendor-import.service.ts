import { HttpStatus, Injectable } from '@nestjs/common';
import { ImportType, UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { BusinessException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import {
  IMPORT_CONFIRM_CHUNK_SIZE,
  IMPORT_ERROR_CODES,
  ImportSummary,
  ImportValidatedRow,
} from '@/modules/imports/import.constants';
import { ImportSessionService } from '@/modules/imports/import-session.service';
import { ExcelParserService } from '@/modules/imports/parsers/excel-parser.service';
import { SUPPLIER_TYPES, SupplierType } from './vendor-code.util';
import { CreateVendorDto } from './dto/vendor.dto';
import { VendorsService } from './vendors.service';

const VENDOR_HEADER_ALIASES: Record<string, string[]> = {
  supplierType: ['Supplier Type', 'supplierType', 'supplier_type', 'Type'],
  name: ['Name', 'Vendor Name', 'Supplier Name', 'name'],
  email: ['Email', 'email'],
  phone: ['Phone', 'phone', 'Mobile'],
  address: ['Address', 'address'],
  city: ['City', 'city'],
  country: ['Country', 'country'],
  taxId: ['Tax ID', 'TaxId', 'taxId', 'tax_id', 'GSTIN', 'VAT'],
  isActive: ['Is Active', 'Active', 'isActive', 'is_active'],
};

const REQUIRED_FIELDS = ['supplierType', 'name'] as const;

@Injectable()
export class VendorImportService {
  constructor(
    private readonly importSessions: ImportSessionService,
    private readonly excelParser: ExcelParserService,
    private readonly vendorsService: VendorsService,
    private readonly auditService: AuditService,
  ) {}

  async downloadTemplate(): Promise<{ buffer: Buffer; fileName: string }> {
    const headers = [
      'Supplier Type',
      'Name',
      'Email',
      'Phone',
      'Address',
      'City',
      'Country',
      'Tax ID',
      'Is Active',
    ];
    const sample = [
      'RM Supplier',
      'Acme Metals Pvt Ltd',
      'buyer@acme.example',
      '+91-9876543210',
      '12 Industrial Area',
      'Chennai',
      'India',
      '',
      'TRUE',
    ];
    const buffer = await this.excelParser.buildTemplate(headers, sample);
    return { buffer, fileName: 'vendor-import-template.xlsx' };
  }

  async validate(companyId: string, actorId: string, file: Express.Multer.File) {
    const sheet = await this.importSessions.parseFile(file);
    const { mapped, missing } = this.importSessions.mapHeaders(
      sheet.headers,
      Object.fromEntries(REQUIRED_FIELDS.map((f) => [f, VENDOR_HEADER_ALIASES[f]])),
    );

    if (missing.length) {
      throw new BusinessException(
        `Missing required column(s): ${missing.join(', ')}`,
        HttpStatus.BAD_REQUEST,
        undefined,
        IMPORT_ERROR_CODES.MISSING_REQUIRED_COLUMN,
      );
    }

    // Map optional columns too
    const allMapped = this.importSessions.mapHeaders(sheet.headers, VENDOR_HEADER_ALIASES).mapped;
    Object.assign(mapped, allMapped);

    const seenNames = new Set<string>();
    const rows: ImportValidatedRow[] = sheet.rows.map((raw, idx) => {
      const rowNumber = idx + 2; // header is row 1
      const data = this.extractRow(raw, mapped);
      const errors = this.validateRow(data, seenNames);
      return {
        rowNumber,
        status: errors.length ? 'INVALID' : 'VALID',
        data,
        errors,
      };
    });

    const summary: ImportSummary = {
      totalRows: rows.length,
      validRows: rows.filter((r) => r.status === 'VALID').length,
      invalidRows: rows.filter((r) => r.status === 'INVALID').length,
    };

    const session = await this.importSessions.createValidatedSession({
      companyId,
      actorId,
      importType: ImportType.VENDOR,
      file,
      rows,
      summary,
    });

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'ImportSession',
      entityId: session.importSessionId.toString(),
      newValue: { type: 'VENDOR', status: 'VALIDATED', ...summary },
    });

    return serialize({
      importId: session.importSessionId.toString(),
      type: 'VENDOR',
      fileName: session.fileName,
      status: session.status,
      summary,
      rows,
      expiresAt: session.expiresAt.toISOString(),
    });
  }

  async getImport(companyId: string, importId: string) {
    const session = await this.importSessions.getSession(companyId, importId, ImportType.VENDOR);
    const rows = this.importSessions.getValidatedRows(session);
    return serialize({
      importId: session.importSessionId.toString(),
      type: session.importType,
      fileName: session.fileName,
      status: session.status,
      summary: session.summaryJson,
      rows,
      errorMessage: session.errorMessage,
      expiresAt: session.expiresAt.toISOString(),
      completedAt: session.completedAt?.toISOString() ?? null,
    });
  }

  async confirm(companyId: string, actorId: string, importId: string) {
    const session = await this.importSessions.getSession(companyId, importId, ImportType.VENDOR);
    this.importSessions.assertConfirmable(session);

    const rows = this.importSessions.getValidatedRows(session);
    await this.importSessions.markImporting(importId);

    let importedRows = 0;
    let skippedRows = 0;
    let failedRows = 0;
    const failDetails: Array<{ rowNumber: number; message: string }> = [];

    try {
      const validRows = rows.filter((r) => r.status === 'VALID');
      for (let i = 0; i < validRows.length; i += IMPORT_CONFIRM_CHUNK_SIZE) {
        const chunk = validRows.slice(i, i + IMPORT_CONFIRM_CHUNK_SIZE);
        for (const row of chunk) {
          // Re-validate row before insert (data may have changed)
          const recheck = this.validateRow(row.data as Record<string, unknown>, new Set());
          if (recheck.length) {
            skippedRows += 1;
            continue;
          }

          try {
            const dto = this.toCreateDto(row.data);
            await this.vendorsService.create(companyId, dto, actorId);
            importedRows += 1;
          } catch (err) {
            failedRows += 1;
            failDetails.push({
              rowNumber: row.rowNumber,
              message: err instanceof Error ? err.message : 'Import failed',
            });
          }
        }
      }

      const summary: ImportSummary = {
        totalRows: rows.length,
        validRows: rows.filter((r) => r.status === 'VALID').length,
        invalidRows: rows.filter((r) => r.status === 'INVALID').length,
        importedRows,
        skippedRows,
        failedRows,
      };

      await this.importSessions.markCompleted(importId, summary);

      await this.auditService.log({
        companyId,
        performedBy: actorId,
        action: UserAuditAction.create,
        entityName: 'VendorImport',
        entityId: importId,
        newValue: summary as unknown as Record<string, unknown>,
      });

      return serialize({
        importId,
        status: 'COMPLETED',
        summary,
        failures: failDetails.slice(0, 50),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      await this.importSessions.markFailed(importId, message);
      throw err;
    }
  }

  private extractRow(
    raw: Record<string, string>,
    mapped: Record<string, string>,
  ): Record<string, unknown> {
    const get = (field: string) => {
      const header = mapped[field];
      return header ? (raw[header] ?? '').trim() : '';
    };

    const isActiveRaw = get('isActive').toLowerCase();
    let isActive: boolean | undefined;
    if (isActiveRaw === 'true' || isActiveRaw === '1' || isActiveRaw === 'yes' || isActiveRaw === 'y') {
      isActive = true;
    } else if (
      isActiveRaw === 'false' ||
      isActiveRaw === '0' ||
      isActiveRaw === 'no' ||
      isActiveRaw === 'n'
    ) {
      isActive = false;
    }

    return {
      supplierType: get('supplierType'),
      name: get('name'),
      email: get('email') || undefined,
      phone: get('phone') || undefined,
      address: get('address') || undefined,
      city: get('city') || undefined,
      country: get('country') || undefined,
      taxId: get('taxId') || undefined,
      isActive,
    };
  }

  private validateRow(
    data: Record<string, unknown>,
    seenNames: Set<string>,
  ): ImportValidatedRow['errors'] {
    const errors: ImportValidatedRow['errors'] = [];
    const supplierType = String(data.supplierType ?? '').trim();
    const name = String(data.name ?? '').trim();

    if (!supplierType) {
      errors.push({
        field: 'supplierType',
        code: IMPORT_ERROR_CODES.MISSING_REQUIRED_FIELD,
        message: 'Supplier Type is required',
      });
    } else if (!(SUPPLIER_TYPES as readonly string[]).includes(supplierType)) {
      errors.push({
        field: 'supplierType',
        code: IMPORT_ERROR_CODES.INVALID_SUPPLIER_TYPE,
        message: `Supplier Type must be one of: ${SUPPLIER_TYPES.join(', ')}`,
      });
    }

    if (!name) {
      errors.push({
        field: 'name',
        code: IMPORT_ERROR_CODES.MISSING_REQUIRED_FIELD,
        message: 'Name is required',
      });
    } else if (name.length > 200) {
      errors.push({
        field: 'name',
        code: IMPORT_ERROR_CODES.INVALID_TEMPLATE,
        message: 'Name must be at most 200 characters',
      });
    } else {
      const key = name.toLowerCase();
      if (seenNames.has(key)) {
        errors.push({
          field: 'name',
          code: IMPORT_ERROR_CODES.DUPLICATE_VENDOR_NAME,
          message: 'Duplicate vendor name in file',
        });
      } else {
        seenNames.add(key);
      }
    }

    const email = data.email ? String(data.email) : '';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push({
        field: 'email',
        code: IMPORT_ERROR_CODES.INVALID_TEMPLATE,
        message: 'Invalid email format',
      });
    }

    return errors;
  }

  private toCreateDto(data: Record<string, unknown>): CreateVendorDto {
    return {
      supplierType: String(data.supplierType) as SupplierType,
      name: String(data.name),
      email: data.email ? String(data.email) : undefined,
      phone: data.phone ? String(data.phone) : undefined,
      address: data.address ? String(data.address) : undefined,
      city: data.city ? String(data.city) : undefined,
      country: data.country ? String(data.country) : undefined,
      taxId: data.taxId ? String(data.taxId) : undefined,
      isActive: typeof data.isActive === 'boolean' ? data.isActive : undefined,
    } as CreateVendorDto;
  }
}
