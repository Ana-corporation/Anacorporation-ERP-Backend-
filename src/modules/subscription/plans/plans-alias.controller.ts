import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions, TenantOptional } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { CreateSubscriptionPlanDto, UpdateSubscriptionPlanDto } from './dto/plan.dto';
import { PlansService } from './plans.service';

/** FE-facing alias of /subscription/plans */
@ApiTags('Plans')
@ApiBearerAuth()
@Controller('plans')
export class PlansAliasController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  @TenantOptional()
  @RequirePermissions('plans:view')
  @ApiOperation({ summary: 'List subscription plans (FE alias)' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.plansService.findAll(query);
  }

  @Get(':id')
  @TenantOptional()
  @RequirePermissions('plans:view')
  @ApiOperation({ summary: 'Get plan by ID (FE alias)' })
  findOne(@Param('id') id: string) {
    return this.plansService.findOne(id);
  }

  @Post()
  @TenantOptional()
  @RequirePermissions('plans:create')
  @ApiOperation({ summary: 'Create plan (FE alias)' })
  create(@Body() dto: CreateSubscriptionPlanDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plansService.create(dto, user.sub);
  }

  @Patch(':id')
  @TenantOptional()
  @RequirePermissions('plans:edit')
  @ApiOperation({ summary: 'Update plan (FE alias)' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionPlanDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.plansService.update(id, dto, user.sub);
  }

  @Delete(':id')
  @TenantOptional()
  @RequirePermissions('plans:delete')
  @ApiOperation({ summary: 'Delete/deactivate plan (FE alias)' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.plansService.remove(id, user.sub);
  }
}
