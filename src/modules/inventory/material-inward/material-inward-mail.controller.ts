import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@/common/decorators/auth.decorators';
import { SchedulerAuthGuard } from '@/common/guards/scheduler-auth.guard';
import { MaterialInwardMailService } from './material-inward-mail.service';

@ApiTags('Internal Scheduler')
@Public()
@UseGuards(SchedulerAuthGuard)
@Controller('internal/material-inward')
export class MaterialInwardMailController {
  constructor(private readonly mail: MaterialInwardMailService) {}

  @Post('emails')
  @ApiOperation({ summary: 'Send due material-inward emails (one Cloud Scheduler job)' })
  processDue() {
    return this.mail.processDue();
  }
}
