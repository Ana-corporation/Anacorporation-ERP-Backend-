import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CompanyId } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { UserAuditService } from './user-audit.service';

@ApiTags('User Audit Logs')
@ApiBearerAuth()
@Controller('users/:userId/audit-logs')
export class UserAuditController {
  constructor(private readonly userAuditService: UserAuditService) {}

  @Get()
  @RequirePermissions('user_audit:view')
  @ApiOperation({ summary: 'List audit logs for a user' })
  findAll(
    @Param('userId') userId: string,
    @CompanyId() companyId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.userAuditService.findAll(userId, companyId, query);
  }

  @Get(':id')
  @RequirePermissions('user_audit:view')
  @ApiOperation({ summary: 'Get audit log entry by ID' })
  findOne(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
  ) {
    return this.userAuditService.findOne(userId, companyId, id);
  }
}
