import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import {
  CreateMachineDto,
  CreateVariantDto,
  MachineListQueryDto,
  MachineLookupQueryDto,
  MachineSettingsDto,
  UpdateMachineDto,
} from './dto/machine.dto';
import { MachinesService } from './machines.service';

const parseId = (raw: string) => (/^\d+$/.test(raw) ? BigInt(raw) : null);

@ApiTags('Machines')
@ApiBearerAuth()
@Controller('companies/:companyId')
export class MachinesController {
  constructor(private readonly machines: MachinesService) {}

  private scope(companyId: string, user: AuthenticatedUser): bigint {
    assertCompanyAccess(companyId, user);
    return parseBigIntId(companyId, 'companyId');
  }

  @Get('machine-settings')
  @RequirePermissions('machines:view')
  @ApiOperation({ summary: 'Category + UOM used for machine items' })
  getSettings(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.machines.getSettings(this.scope(companyId, user));
  }

  @Put('machine-settings')
  @RequirePermissions('machines:edit')
  @ApiOperation({ summary: 'Set the category + UOM used for machine items' })
  saveSettings(@Param('companyId') companyId: string, @Body() dto: MachineSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.machines.saveSettings(this.scope(companyId, user), dto, user);
  }

  @Get('machines')
  @RequirePermissions('machines:view')
  @ApiOperation({ summary: 'List machines (base + customised)' })
  list(@Param('companyId') companyId: string, @Query() query: MachineListQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.machines.list(this.scope(companyId, user), query, user);
  }

  @Get('machines/lookup')
  @RequirePermissions('machines:view')
  @ApiOperation({ summary: 'BOM Machine dropdown: active machines only' })
  lookup(@Param('companyId') companyId: string, @Query() query: MachineLookupQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.machines.lookup(this.scope(companyId, user), query);
  }

  @Post('machines')
  @RequirePermissions('machines:create')
  @ApiOperation({ summary: 'Create a base machine (its item is created, or linkItemId attaches an existing one)' })
  create(@Param('companyId') companyId: string, @Body() dto: CreateMachineDto, @CurrentUser() user: AuthenticatedUser) {
    return this.machines.create(this.scope(companyId, user), dto, user);
  }

  @Get('machines/:machineId')
  @RequirePermissions('machines:view')
  @ApiOperation({ summary: 'Machine detail + linked item + BOMs + customised machines' })
  get(@Param('companyId') companyId: string, @Param('machineId') machineId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.machines.get(this.scope(companyId, user), parseId(machineId), user);
  }

  @Patch('machines/:machineId')
  @RequirePermissions('machines:edit')
  @ApiOperation({ summary: 'Update a machine (code and type are fixed)' })
  update(
    @Param('companyId') companyId: string,
    @Param('machineId') machineId: string,
    @Body() dto: UpdateMachineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.machines.update(this.scope(companyId, user), parseId(machineId), dto, user);
  }

  @Delete('machines/:machineId')
  @RequirePermissions('machines:delete')
  @ApiOperation({ summary: 'Delete a machine without BOMs / customised machines' })
  remove(@Param('companyId') companyId: string, @Param('machineId') machineId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.machines.remove(this.scope(companyId, user), parseId(machineId), user);
  }

  @Get('machines/:machineId/variants')
  @RequirePermissions('machines:view')
  @ApiOperation({ summary: 'Customised machines of a base machine' })
  variants(@Param('companyId') companyId: string, @Param('machineId') machineId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.machines.listVariants(this.scope(companyId, user), parseId(machineId), user);
  }

  @Post('machines/:machineId/variants')
  @RequirePermissions('machines:create', 'boms:create')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Customised machine BS500-SO00045 + its item + CUSTOMER BOM draft copied from the base BOM' })
  createVariant(
    @Param('companyId') companyId: string,
    @Param('machineId') machineId: string,
    @Body() dto: CreateVariantDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.machines.createVariant(this.scope(companyId, user), parseId(machineId), dto, user, key);
  }
}
