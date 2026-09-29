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

@ApiTags('Vendors')
@ApiBearerAuth()
@Controller('companies/:companyId/vendor-form')
export class VendorRegistrationInvitationController {
  constructor(private readonly vendorFormService: VendorFormInvitationService) {}

  @Post('invitations')
  @RequirePermissions('vendors:create')
  @ApiOperation({
    summary: 'Send Vendor Registration: create a draft vendor and email the registration form',
  })
  createInvitation(
    @Param('companyId') companyId: string,
    @Body() dto: GenerateVendorEmailDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.vendorFormService.createRegistrationInvitation(companyId, dto, user.sub);
  }

  @Get('preview')
  @RequirePermissions('vendors:edit')
  @ApiOperation({
    summary: 'Registration form preview: fields a new vendor link shows (ignores staff Tab Access)',
  })
  preview(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.vendorFormService.getRegistrationPreview(companyId);
  }
}
