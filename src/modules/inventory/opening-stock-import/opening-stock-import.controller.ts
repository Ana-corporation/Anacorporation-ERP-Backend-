import { Body, Controller, Get, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { IMPORT_MAX_FILE_BYTES } from '@/modules/imports/import.constants';
import {
  OpeningImportApproveDto,
  OpeningImportExcludeDto,
  OpeningImportListQueryDto,
  OpeningImportRowUpdateDto,
  OpeningImportRowsQueryDto,
  OpeningImportUploadDto,
} from './dto/opening-stock-import.dto';
import { OpeningStockImportService } from './opening-stock-import.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@ApiTags('Opening Stock Import')
@ApiBearerAuth()
@Controller('companies/:companyId/inventory/opening-stock-imports')
export class OpeningStockImportController {
  constructor(private readonly service: OpeningStockImportService) {}

  @Get('template')
  @RequirePermissions('opening_stock:create')
  @ApiOperation({ summary: 'Download the Excel template' })
  async template(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    assertCompanyAccess(companyId, user);
    const { buffer, fileName } = await this.service.template();
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }

  @Post()
  @RequirePermissions('opening_stock:create')
  @ApiOperation({ summary: 'Upload Excel/CSV → Draft batch, validated + matched (nothing posted)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' }, documentDate: { type: 'string', example: '2026-10-01' } },
      required: ['file'],
    },
  })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: IMPORT_MAX_FILE_BYTES } }))
  upload(
    @Param('companyId') companyId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: OpeningImportUploadDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.service.upload(companyId, user.sub, file, dto.documentDate);
  }

  @Get()
  @RequirePermissions('opening_stock:view')
  @ApiOperation({ summary: 'List import batches (newest first)' })
  list(@Param('companyId') companyId: string, @Query() query: OpeningImportListQueryDto, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.service.list(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('opening_stock:view')
  @ApiOperation({ summary: 'Batch summary: matched, errors, excluded, total value, canApprove' })
  summary(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.service.summary(companyId, id);
  }

  @Get(':id/rows')
  @RequirePermissions('opening_stock:view')
  @ApiOperation({ summary: 'Rows with filters: matchStatus MATCHED | ERROR, excluded, search' })
  rows(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Query() query: OpeningImportRowsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.service.listRows(companyId, id, query);
  }

  @Patch(':id/rows/:rowId')
  @RequirePermissions('opening_stock:create')
  @ApiOperation({ summary: 'Edit a row (cell values, e.g. correct the Part Number); the batch is re-validated' })
  updateRow(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Param('rowId') rowId: string,
    @Body() dto: OpeningImportRowUpdateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.service.updateRow(companyId, id, rowId, dto);
  }

  @Post(':id/rows/exclude')
  @RequirePermissions('opening_stock:create')
  @ApiOperation({ summary: 'Leave rows out of (or back into) the approve' })
  exclude(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: OpeningImportExcludeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.service.setExcluded(companyId, id, dto);
  }

  @Post(':id/validate')
  @RequirePermissions('opening_stock:create')
  @ApiOperation({ summary: 'Re-validate every row against current masters' })
  validate(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.service.validateBatch(companyId, id);
  }

  @Post(':id/approve')
  @RequirePermissions('opening_stock:approve')
  @ApiOperation({ summary: 'Post opening stock for the Matched rows in one transaction (never creates items)' })
  approve(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: OpeningImportApproveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.service.approve(companyId, id, user.sub, dto ?? {});
  }

  @Get(':id/created-items')
  @RequirePermissions('opening_stock:view')
  @ApiOperation({ summary: 'Items created by older imports (history; new imports never create items)' })
  createdItems(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.service.createdItems(companyId, id);
  }

  @Get(':id/error-report')
  @RequirePermissions('opening_stock:view')
  @ApiOperation({ summary: 'Excel of error rows (and new rows without Item Group) with an Errors column' })
  async errorReport(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    assertCompanyAccess(companyId, user);
    const { buffer, fileName } = await this.service.errorReport(companyId, id);
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }
}
