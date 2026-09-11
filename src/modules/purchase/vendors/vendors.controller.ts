import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { CreateVendorDto, UpdateVendorDto } from './dto/vendor.dto';
import { VendorListQueryDto } from './dto/vendor-list-query.dto';
import { VENDOR_ATTACHMENT_MAX_BYTES } from './vendor-attachments.constants';
import { VendorsService } from './vendors.service';

type UploadedMulterFile = {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

@ApiTags('Vendors')
@ApiBearerAuth()
@Controller('companies/:companyId/vendors')
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Get()
  @RequirePermissions('vendors:view')
  findAll(
    @Param('companyId') companyId: string,
    @Query() query: VendorListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.vendorsService.findAll(companyId, query);
  }

  @Post(':id/attachments')
  @ApiOperation({ summary: 'Upload one or more vendor attachment files' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @RequirePermissions('vendors:edit')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'files', maxCount: 20 },
        { name: 'file', maxCount: 20 },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: VENDOR_ATTACHMENT_MAX_BYTES },
      },
    ),
  )
  uploadAttachments(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @UploadedFiles()
    uploaded: { files?: UploadedMulterFile[]; file?: UploadedMulterFile[] },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    const files = [...(uploaded?.files ?? []), ...(uploaded?.file ?? [])];
    return this.vendorsService.uploadAttachments(id, companyId, files, user.sub);
  }

  @Get(':id/attachments/:fileAssetId/url')
  @ApiOperation({ summary: 'Get signed download URL for a vendor attachment' })
  @RequirePermissions('vendors:view')
  getAttachmentUrl(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Param('fileAssetId') fileAssetId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.vendorsService.getAttachmentSignedUrl(id, companyId, fileAssetId);
  }

  @Delete(':id/attachments/:fileAssetId')
  @ApiOperation({ summary: 'Delete an uploaded vendor attachment' })
  @RequirePermissions('vendors:edit')
  deleteAttachment(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Param('fileAssetId') fileAssetId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.vendorsService.deleteAttachment(id, companyId, fileAssetId, user.sub);
  }

  @Get(':id')
  @RequirePermissions('vendors:view')
  findOne(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.vendorsService.findOne(id, companyId);
  }

  @Post()
  @RequirePermissions('vendors:create')
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateVendorDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.vendorsService.create(companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('vendors:edit')
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateVendorDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.vendorsService.update(id, companyId, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('vendors:delete')
  remove(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.vendorsService.remove(id, companyId, user.sub);
  }
}
