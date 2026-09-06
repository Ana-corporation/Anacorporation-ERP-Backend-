import {
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { ConfirmImportDto } from '@/modules/imports/dto/import.dto';
import { IMPORT_MAX_FILE_BYTES } from '@/modules/imports/import.constants';
import { VendorImportService } from './vendor-import.service';

@ApiTags('Vendor Import')
@ApiBearerAuth()
@Controller('companies/:companyId/vendors/import')
export class VendorImportController {
  constructor(private readonly vendorImportService: VendorImportService) {}

  @Get('template')
  @RequirePermissions('vendors:create')
  @ApiOperation({ summary: 'Download vendor import Excel template' })
  async downloadTemplate(
    @Param('companyId') companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    assertCompanyAccess(companyId, user);
    const { buffer, fileName } = await this.vendorImportService.downloadTemplate();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }

  @Post('validate')
  @RequirePermissions('vendors:create')
  @ApiOperation({ summary: 'Upload and validate vendor import file' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: IMPORT_MAX_FILE_BYTES },
    }),
  )
  validate(
    @Param('companyId') companyId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.vendorImportService.validate(companyId, user.sub, file);
  }

  @Post('confirm')
  @RequirePermissions('vendors:create')
  @ApiOperation({ summary: 'Confirm vendor import by importId only' })
  confirm(
    @Param('companyId') companyId: string,
    @Body() dto: ConfirmImportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.vendorImportService.confirm(companyId, user.sub, dto.importId);
  }

  @Get(':importId')
  @RequirePermissions('vendors:create')
  @ApiOperation({ summary: 'Get vendor import session status and rows' })
  getImport(
    @Param('companyId') companyId: string,
    @Param('importId') importId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.vendorImportService.getImport(companyId, importId);
  }
}
