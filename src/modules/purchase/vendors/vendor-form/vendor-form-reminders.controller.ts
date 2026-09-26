import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@/common/decorators/auth.decorators';
import { SchedulerAuthGuard } from '@/common/guards/scheduler-auth.guard';
import { VendorFormInvitationService } from './vendor-form-invitation.service';

@ApiTags('Internal Scheduler')
@Public()
@UseGuards(SchedulerAuthGuard)
@Controller('internal/vendor-form')
export class VendorFormRemindersController {
  constructor(private readonly vendorFormService: VendorFormInvitationService) {}

  @Post('reminders')
  @ApiOperation({ summary: 'Process pending vendor form reminder emails (Cloud Scheduler)' })
  processReminders() {
    return this.vendorFormService.processReminders();
  }
}
