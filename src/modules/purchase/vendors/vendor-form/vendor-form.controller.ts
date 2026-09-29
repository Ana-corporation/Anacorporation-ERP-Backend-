import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { Public } from '@/common/decorators/auth.decorators';
import { VendorFormGstinRateLimitGuard } from '@/common/guards/vendor-form-gstin-rate-limit.guard';
import { VendorFormRateLimitGuard } from '@/common/guards/vendor-form-rate-limit.guard';
import { SubmitVendorFormDto, VerifyVendorFormGstinDto } from './dto/vendor-form.dto';
import { VendorFormAttachmentGuard } from './vendor-form-attachment.guard';
import {
  VENDOR_FORM_ATTACHMENT_MAX_BYTES,
  VENDOR_FORM_ATTACHMENT_MAX_FILES,
} from './vendor-form-attachments.util';
import {
  UploadedVendorFormFile,
  VendorFormInvitationService,
} from './vendor-form-invitation.service';
import { VendorFormUploadErrorsInterceptor } from './vendor-form-upload-errors.interceptor';

@ApiTags('Vendor Form (Public)')
@Public()
@UseGuards(VendorFormRateLimitGuard)
@Controller('vendor-form')
export class VendorFormController {
  constructor(private readonly vendorFormService: VendorFormInvitationService) {}

  @Get(':token')
  @ApiOperation({ summary: 'Validate token and retrieve vendor form data' })
  getForm(@Param('token') token: string) {
    return this.vendorFormService.getFormByToken(token);
  }

  @Post(':token/submit')
  @ApiOperation({ summary: 'Submit vendor form (one-time)' })
  submitForm(@Param('token') token: string, @Body() dto: SubmitVendorFormDto) {
    return this.vendorFormService.submitForm(token, dto);
  }

  @Post(':token/gstin/verify')
  @UseGuards(VendorFormGstinRateLimitGuard)
  @ApiOperation({ summary: 'Verify a GSTIN from the public vendor form (5 calls per link per 10 minutes)' })
  verifyGstin(@Param('token') token: string, @Body() dto: VerifyVendorFormGstinDto) {
    return this.vendorFormService.verifyGstinByToken(token, dto);
  }

  @Post(':token/attachments')
  @UseGuards(VendorFormAttachmentGuard)
  @ApiOperation({ summary: 'Upload documents from the public vendor form (authorised by the token)' })
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
  @UseInterceptors(
    VendorFormUploadErrorsInterceptor,
    FileFieldsInterceptor(
      [
        { name: 'files', maxCount: VENDOR_FORM_ATTACHMENT_MAX_FILES },
        { name: 'file', maxCount: VENDOR_FORM_ATTACHMENT_MAX_FILES },
      ],
      {
        storage: memoryStorage(),
        limits: {
          fileSize: VENDOR_FORM_ATTACHMENT_MAX_BYTES,
          files: VENDOR_FORM_ATTACHMENT_MAX_FILES,
        },
      },
    ),
  )
  uploadAttachments(
    @Param('token') token: string,
    @UploadedFiles()
    uploaded: { files?: UploadedVendorFormFile[]; file?: UploadedVendorFormFile[] },
  ) {
    const files = [...(uploaded?.files ?? []), ...(uploaded?.file ?? [])];
    return this.vendorFormService.uploadAttachmentsByToken(token, files);
  }

  @Delete(':token/attachments/:fileAssetId')
  @UseGuards(VendorFormAttachmentGuard)
  @ApiOperation({ summary: 'Remove a document uploaded through this vendor form link' })
  deleteAttachment(@Param('token') token: string, @Param('fileAssetId') fileAssetId: string) {
    return this.vendorFormService.deleteAttachmentByToken(token, fileAssetId);
  }
}
