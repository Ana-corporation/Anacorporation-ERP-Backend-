import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { AddPlanModuleDto, ReplacePlanModulesDto } from './dto/plan-module.dto';
import { PlanModulesService } from './plan-modules.service';

@ApiTags('Plan Modules')
@ApiBearerAuth()
@Controller('subscription/plans/:planId/modules')
export class PlanModulesController {
  constructor(private readonly planModulesService: PlanModulesService) {}

  @Get()
  @RequirePermissions('plan_modules:view')
  @ApiOperation({ summary: 'List modules included in a plan' })
  findAll(@Param('planId') planId: string, @Query() query: PaginationQueryDto) {
    return this.planModulesService.findAll(planId, query);
  }

  @Get(':id')
  @RequirePermissions('plan_modules:view')
  @ApiOperation({ summary: 'Get plan-module link by ID' })
  findOne(@Param('planId') planId: string, @Param('id') id: string) {
    return this.planModulesService.findOne(planId, id);
  }

  @Post()
  @RequirePermissions('plan_modules:manage')
  @ApiOperation({ summary: 'Add module to subscription plan' })
  create(
    @Param('planId') planId: string,
    @Body() dto: AddPlanModuleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.planModulesService.create(planId, dto, user.sub);
  }

  @Put()
  @RequirePermissions('plan_modules:manage')
  @ApiOperation({ summary: 'Replace all modules on a subscription plan' })
  replaceAll(
    @Param('planId') planId: string,
    @Body() dto: ReplacePlanModulesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.planModulesService.replaceAll(planId, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('plan_modules:manage')
  @ApiOperation({ summary: 'Remove module from subscription plan' })
  remove(
    @Param('planId') planId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.planModulesService.remove(planId, id, user.sub);
  }
}
