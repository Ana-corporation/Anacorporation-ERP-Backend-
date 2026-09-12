import { HttpStatus, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { BusinessException } from '@/common/exceptions/business.exception';
import { IMPORT_ERROR_CODES } from '../import.constants';
import { ParsedSheet } from './csv-parser.service';

@Injectable()
export class ExcelParserService {
  async parse(buffer: Buffer): Promise<ParsedSheet> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BusinessException(
        'Unable to parse Excel file',
        HttpStatus.BAD_REQUEST,
        undefined,
        IMPORT_ERROR_CODES.INVALID_TEMPLATE,
      );
    }

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new BusinessException(
        'Excel file has no worksheets',
        HttpStatus.BAD_REQUEST,
        undefined,
        IMPORT_ERROR_CODES.EMPTY_FILE,
      );
    }

    const headerRow = sheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: false }, (cell: ExcelJS.Cell, colNumber: number) => {
      headers[colNumber - 1] = String(cell.text ?? cell.value ?? '').trim();
    });

    if (!headers.filter(Boolean).length) {
      throw new BusinessException(
        'Excel file is missing a header row',
        HttpStatus.BAD_REQUEST,
        undefined,
        IMPORT_ERROR_CODES.INVALID_TEMPLATE,
      );
    }

    const rows: Record<string, string>[] = [];
    sheet.eachRow({ includeEmpty: false }, (row: ExcelJS.Row, rowNumber: number) => {
      if (rowNumber === 1) return;
      const data: Record<string, string> = {};
      let hasValue = false;
      headers.forEach((header, idx) => {
        if (!header) return;
        const cell = row.getCell(idx + 1);
        const raw = cell.text ?? cell.value;
        const value = raw == null ? '' : String(raw).trim();
        data[header] = value;
        if (value) hasValue = true;
      });
      if (hasValue) rows.push(data);
    });

    if (!rows.length) {
      throw new BusinessException(
        'Import file has no data rows',
        HttpStatus.BAD_REQUEST,
        undefined,
        IMPORT_ERROR_CODES.EMPTY_FILE,
      );
    }

    return { headers: headers.filter(Boolean), rows };
  }

  async buildTemplate(headers: string[], sampleRow?: string[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Template');
    sheet.addRow(headers);
    if (sampleRow?.length) sheet.addRow(sampleRow);
    sheet.getRow(1).font = { bold: true };
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }
}
