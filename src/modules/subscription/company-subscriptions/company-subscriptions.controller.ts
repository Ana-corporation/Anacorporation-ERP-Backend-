import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { CreateCompanySubscriptionDto, UpdateCompanySubscriptionDto } from './dto/company-subscription.dto';
import { CompanySubscriptionsService } from './company-subscriptions.service';

@ApiTags('Company Subscriptions')
@ApiBearerAuth()
@Controller('companies/:companyId/subscriptions')
export class CompanySubscriptionsController {
  constructor(private readonly companySubscriptionsService: CompanySubscriptionsService) {}

  @Get()
  @RequirePermissions('company_subscriptions:view')
  @ApiOperation({ summary: 'List subscriptions for company' })
  findAll(@Param('companyId') companyId: string, @Query() query: PaginationQueryDto) {
    return this.companySubscriptionsService.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('company_subscriptions:view')
  @ApiOperation({ summary: 'Get company subscription by ID' })
  findOne(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.companySubscriptionsService.findOne(id, companyId);
  }

  @Post()
  @RequirePermissions('company_subscriptions:create')
  @ApiOperation({ summary: 'Create company subscription' })
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateCompanySubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.companySubscriptionsService.create(companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('company_subscriptions:edit')
  @ApiOperation({ summary: 'Update company subscription' })
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCompanySubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.companySubscriptionsService.update(id, companyId, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('company_subscriptions:delete')
  @ApiOperation({ summary: 'Delete company subscription' })
  remove(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.companySubscriptionsService.remove(id, companyId, user.sub);
  }
}
