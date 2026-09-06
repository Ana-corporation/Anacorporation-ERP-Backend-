import { Module } from '@nestjs/common';
import { ImportSessionService } from './import-session.service';
import { CsvParserService } from './parsers/csv-parser.service';
import { ExcelParserService } from './parsers/excel-parser.service';

@Module({
  providers: [ImportSessionService, ExcelParserService, CsvParserService],
  exports: [ImportSessionService, ExcelParserService, CsvParserService],
})
export class ImportsModule {}
