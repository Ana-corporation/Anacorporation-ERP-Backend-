import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
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
import { ItemImportService } from './item-import.service';

@ApiTags('Item Import')
@ApiBearerAuth()
@Controller('companies/:companyId/items/import')
export class ItemImportController {
  constructor(private readonly itemImportService: ItemImportService) {}

  @Get('template')
  @RequirePermissions('items:create')
  @ApiOperation({ summary: 'Download item import Excel template (Material Type / Segment / Process)' })
  async downloadTemplate(
    @Param('companyId') companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    assertCompanyAccess(companyId, user);
    const { buffer, fileName } = await this.itemImportService.downloadTemplate();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }

  @Post('validate')
  @RequirePermissions('items:create')
  @ApiOperation({ summary: 'Upload and validate item import file' })
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
    return this.itemImportService.validate(companyId, user.sub, file);
  }

  @Post('confirm')
  @RequirePermissions('items:create')
  @ApiOperation({ summary: 'Confirm item import by importId only' })
  confirm(
    @Param('companyId') companyId: string,
    @Body() dto: ConfirmImportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.itemImportService.confirm(companyId, user.sub, dto.importId);
  }

  @Get(':importId')
  @RequirePermissions('items:create')
  @ApiOperation({ summary: 'Get item import session status and rows' })
  getImport(
    @Param('companyId') companyId: string,
    @Param('importId') importId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.itemImportService.getImport(companyId, importId);
  }
}
