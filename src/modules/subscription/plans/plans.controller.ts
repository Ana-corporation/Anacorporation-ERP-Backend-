import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { CreateSubscriptionPlanDto, UpdateSubscriptionPlanDto } from './dto/plan.dto';
import { PlansService } from './plans.service';

@ApiTags('Subscription Plans')
@ApiBearerAuth()
@Controller('subscription/plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  @RequirePermissions('subscription_plans:view')
  @ApiOperation({ summary: 'List subscription plans' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.plansService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('subscription_plans:view')
  @ApiOperation({ summary: 'Get subscription plan by ID' })
  findOne(@Param('id') id: string) {
    return this.plansService.findOne(id);
  }

  @Post()
  @RequirePermissions('subscription_plans:create')
  @ApiOperation({ summary: 'Create subscription plan' })
  create(@Body() dto: CreateSubscriptionPlanDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plansService.create(dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('subscription_plans:edit')
  @ApiOperation({ summary: 'Update subscription plan' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionPlanDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.plansService.update(id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('subscription_plans:delete')
  @ApiOperation({ summary: 'Delete subscription plan' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.plansService.remove(id, user.sub);
  }
}
