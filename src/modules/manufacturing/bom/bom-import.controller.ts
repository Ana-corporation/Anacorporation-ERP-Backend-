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
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { bigintIdSchema } from '@/common/zod/common.schemas';
import { IMPORT_MAX_FILE_BYTES } from '@/modules/imports/import.constants';
import { BomImportService } from './bom-import.service';

const emptyToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);
const optionalId = z.preprocess(emptyToUndefined, bigintIdSchema.optional());

export const ConfirmBomImportSchema = z
  .object({
    importId: bigintIdSchema,
    parentItemId: optionalId,
    machineId: optionalId,
    bomType: z.enum(['ENGINEERING', 'MANUFACTURING']).optional().default('MANUFACTURING'),
    baseQuantity: z.preprocess(emptyToUndefined, z.string().trim().max(40).optional()),
    revisionLabel: z.preprocess(emptyToUndefined, z.string().trim().max(10).optional()),
    remarks: z.preprocess(emptyToUndefined, z.string().trim().max(5000).optional()),
  })
  .refine((v) => Boolean(v.parentItemId || v.machineId), {
    message: 'parentItemId or machineId is required',
    path: ['parentItemId'],
  });

export class ConfirmBomImportDto extends createZodDto(ConfirmBomImportSchema) {}

@ApiTags('BOM Import')
@ApiBearerAuth()
@Controller('companies/:companyId/boms/import')
export class BomImportController {
  constructor(private readonly bomImportService: BomImportService) {}

  @Get('template')
  @RequirePermissions('boms:create')
  @ApiOperation({ summary: 'Download BOM Excel import template (Find Number / Part / Qty)' })
  async downloadTemplate(
    @Param('companyId') companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    assertCompanyAccess(companyId, user);
    const { buffer, fileName } = await this.bomImportService.downloadTemplate();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }

  @Post('validate')
  @RequirePermissions('boms:create')
  @ApiOperation({ summary: 'Upload and validate BOM Excel (Draft only on confirm)' })
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
    return this.bomImportService.validate(companyId, user.sub, file);
  }

  @Post('confirm')
  @RequirePermissions('boms:create')
  @ApiOperation({ summary: 'Confirm BOM import → creates DRAFT BOM and returns bomId' })
  confirm(
    @Param('companyId') companyId: string,
    @Body() dto: ConfirmBomImportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.bomImportService.confirm(companyId, user, dto);
  }

  @Get(':importId')
  @RequirePermissions('boms:create')
  @ApiOperation({ summary: 'Get BOM import session status and rows' })
  getImport(
    @Param('companyId') companyId: string,
    @Param('importId') importId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.bomImportService.getImport(companyId, importId);
  }
}
