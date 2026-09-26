import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@/common/decorators/auth.decorators';
import { VendorFormRateLimitGuard } from '@/common/guards/vendor-form-rate-limit.guard';
import { SubmitVendorFormDto } from './dto/vendor-form.dto';
import { VendorFormInvitationService } from './vendor-form-invitation.service';

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
}
