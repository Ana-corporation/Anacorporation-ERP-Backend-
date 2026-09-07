import { HttpStatus, Injectable } from '@nestjs/common';
import { ImportStatus, ImportType } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { BusinessException, NotFoundException } from '@/common/exceptions/business.exception';
import { parseBigIntId } from '@/common/utils/bigint.util';
import {
  IMPORT_ALLOWED_EXTENSIONS,
  IMPORT_ALLOWED_MIME,
  IMPORT_ERROR_CODES,
  IMPORT_MAX_FILE_BYTES,
  IMPORT_MAX_ROWS,
  IMPORT_SESSION_TTL_HOURS,
  ImportSummary,
  ImportValidatedRow,
} from './import.constants';
import { CsvParserService, ParsedSheet } from './parsers/csv-parser.service';
import { ExcelParserService } from './parsers/excel-parser.service';

@Injectable()
export class ImportSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly excelParser: ExcelParserService,
    private readonly csvParser: CsvParserService,
  ) {}

  assertFile(file?: Express.Multer.File) {
    if (!file?.buffer?.length) {
      throw new BusinessException(
        'File is required',
        HttpStatus.BAD_REQUEST,
        undefined,
        IMPORT_ERROR_CODES.INVALID_FILE_TYPE,
      );
    }

    if (file.size > IMPORT_MAX_FILE_BYTES) {
      throw new BusinessException(
        `File exceeds maximum size of ${IMPORT_MAX_FILE_BYTES / (1024 * 1024)} MB`,
        HttpStatus.BAD_REQUEST,
        undefined,
        IMPORT_ERROR_CODES.FILE_TOO_LARGE,
      );
    }

    const ext = (file.originalname.split('.').pop() ?? '').toLowerCase();
    if (!IMPORT_ALLOWED_EXTENSIONS.has(ext)) {
      throw new BusinessException(
        'Only .xlsx and .csv files are allowed',
        HttpStatus.BAD_REQUEST,
        undefined,
        IMPORT_ERROR_CODES.INVALID_FILE_TYPE,
      );
    }

    const mime = (file.mimetype ?? '').toLowerCase();
    if (mime && !IMPORT_ALLOWED_MIME.has(mime) && ext === 'xlsx' && !mime.includes('sheet')) {
      // Allow some browsers sending octet-stream for xlsx/csv when extension is valid
      if (mime !== 'application/octet-stream') {
        throw new BusinessException(
          'Invalid file MIME type',
          HttpStatus.BAD_REQUEST,
          undefined,
          IMPORT_ERROR_CODES.INVALID_FILE_TYPE,
        );
      }
    }

    return ext as 'xlsx' | 'csv';
  }

  async parseFile(file: Express.Multer.File): Promise<ParsedSheet> {
    const ext = this.assertFile(file);
    const sheet =
      ext === 'csv'
        ? this.csvParser.parse(file.buffer)
        : await this.excelParser.parse(file.buffer);

    if (sheet.rows.length > IMPORT_MAX_ROWS) {
      throw new BusinessException(
        `Import exceeds maximum of ${IMPORT_MAX_ROWS} rows`,
        HttpStatus.BAD_REQUEST,
        undefined,
        IMPORT_ERROR_CODES.IMPORT_TOO_MANY_ROWS,
      );
    }

    return sheet;
  }

  normalizeHeaderKey(header: string): string {
    return header.trim().toLowerCase().replace(/[\s_]+/g, ' ');
  }

  mapHeaders(
    headers: string[],
    aliases: Record<string, string[]>,
  ): { mapped: Record<string, string>; missing: string[] } {
    const normalizedHeaders = headers.map((h) => ({
      original: h,
      key: this.normalizeHeaderKey(h),
    }));

    const mapped: Record<string, string> = {};
    const missing: string[] = [];

    for (const [field, names] of Object.entries(aliases)) {
      const match = normalizedHeaders.find((h) =>
        names.map((n) => this.normalizeHeaderKey(n)).includes(h.key),
      );
      if (match) mapped[field] = match.original;
      else missing.push(field);
    }

    return { mapped, missing };
  }

  async createValidatedSession(params: {
    companyId: string;
    actorId: string;
    importType: ImportType;
    file: Express.Multer.File;
    rows: ImportValidatedRow[];
    summary: ImportSummary;
  }) {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + IMPORT_SESSION_TTL_HOURS);

    return this.prisma.importSession.create({
      data: {
        companyId: parseBigIntId(params.companyId),
        createdBy: parseBigIntId(params.actorId),
        importType: params.importType,
        status: ImportStatus.VALIDATED,
        fileName: params.file.originalname,
        fileMime: params.file.mimetype,
        fileSizeBytes: params.file.size,
        summaryJson: params.summary as object,
        rowsJson: params.rows as object[],
        expiresAt,
      },
    });
  }

  async getSession(companyId: string, importId: string, importType: ImportType) {
    const session = await this.prisma.importSession.findFirst({
      where: {
        importSessionId: parseBigIntId(importId),
        companyId: parseBigIntId(companyId),
        importType,
        deletedAt: null,
      },
    });
    if (!session) {
      throw new NotFoundException('Import session');
    }
    return session;
  }

  assertConfirmable(session: {
    status: ImportStatus;
    expiresAt: Date;
  }) {
    if (session.status === ImportStatus.COMPLETED) {
      throw new BusinessException(
        'Import already completed',
        HttpStatus.CONFLICT,
        undefined,
        IMPORT_ERROR_CODES.IMPORT_ALREADY_COMPLETED,
      );
    }
    if (session.expiresAt.getTime() < Date.now() || session.status === ImportStatus.EXPIRED) {
      throw new BusinessException(
        'Import session has expired. Please re-upload the file.',
        HttpStatus.BAD_REQUEST,
        undefined,
        IMPORT_ERROR_CODES.IMPORT_EXPIRED,
      );
    }
    if (session.status !== ImportStatus.VALIDATED) {
      throw new BusinessException(
        `Import cannot be confirmed from status ${session.status}`,
        HttpStatus.BAD_REQUEST,
        undefined,
        IMPORT_ERROR_CODES.IMPORT_INVALID_STATUS,
      );
    }
  }

  async markImporting(importId: string) {
    return this.prisma.importSession.update({
      where: { importSessionId: parseBigIntId(importId) },
      data: {
        status: ImportStatus.IMPORTING,
        startedAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  async markCompleted(importId: string, summary: ImportSummary) {
    return this.prisma.importSession.update({
      where: { importSessionId: parseBigIntId(importId) },
      data: {
        status: ImportStatus.COMPLETED,
        summaryJson: summary as object,
        completedAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  async markFailed(importId: string, message: string) {
    return this.prisma.importSession.update({
      where: { importSessionId: parseBigIntId(importId) },
      data: {
        status: ImportStatus.FAILED,
        errorMessage: message,
        updatedAt: new Date(),
        completedAt: new Date(),
      },
    });
  }

  getValidatedRows(session: { rowsJson: unknown }): ImportValidatedRow[] {
    const rows = session.rowsJson;
    if (!Array.isArray(rows)) return [];
    return rows as ImportValidatedRow[];
  }
}
