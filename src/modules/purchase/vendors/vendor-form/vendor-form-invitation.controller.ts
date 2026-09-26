import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { GenerateVendorEmailDto } from './dto/vendor-form.dto';
import { VendorFormInvitationService } from './vendor-form-invitation.service';

@ApiTags('Vendors')
@ApiBearerAuth()
@Controller('companies/:companyId/vendors/:id')
export class VendorFormInvitationController {
  constructor(private readonly vendorFormService: VendorFormInvitationService) {}

  @Post('generate-email')
  @RequirePermissions('vendors:edit')
  @ApiOperation({ summary: 'Generate secure vendor form link and send email' })
  generateEmail(
    @Param('companyId') companyId: string,
    @Param('id') vendorId: string,
    @Body() dto: GenerateVendorEmailDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.vendorFormService.generateEmail(vendorId, companyId, dto, user.sub);
  }

  @Get('email-status')
  @RequirePermissions('vendors:view')
  @ApiOperation({ summary: 'Get vendor form invitation / email send status' })
  emailStatus(
    @Param('companyId') companyId: string,
    @Param('id') vendorId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.vendorFormService.getEmailStatus(vendorId, companyId);
  }
}
