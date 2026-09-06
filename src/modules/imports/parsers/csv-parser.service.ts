import { Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { IMPORT_ERROR_CODES } from '../import.constants';
import { BusinessException } from '@/common/exceptions/business.exception';
import { HttpStatus } from '@nestjs/common';

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, string>[];
}

@Injectable()
export class CsvParserService {
  parse(buffer: Buffer): ParsedSheet {
    let records: Record<string, string>[];
    try {
      records = parse(buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        bom: true,
      }) as Record<string, string>[];
    } catch {
      throw new BusinessException(
        'Unable to parse CSV file',
        HttpStatus.BAD_REQUEST,
        undefined,
        IMPORT_ERROR_CODES.INVALID_TEMPLATE,
      );
    }

    if (!records.length) {
      throw new BusinessException(
        'Import file has no data rows',
        HttpStatus.BAD_REQUEST,
        undefined,
        IMPORT_ERROR_CODES.EMPTY_FILE,
      );
    }

    const headers = Object.keys(records[0] ?? {}).map((h) => h.trim());
    const rows = records.map((row) => {
      const normalized: Record<string, string> = {};
      for (const [key, value] of Object.entries(row)) {
        normalized[key.trim()] = value == null ? '' : String(value).trim();
      }
      return normalized;
    });

    return { headers, rows };
  }
}
