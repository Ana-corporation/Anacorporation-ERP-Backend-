import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { RequireModulePermission, RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser, OrganizationId } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';

@ApiTags('Customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @RequirePermissions('customers:read')
  @RequireModulePermission('crm', 'view')
  findAll(@OrganizationId() organizationId: string, @Query() query: PaginationQueryDto) {
    return this.customersService.findAll(organizationId, query);
  }

  @Get(':id')
  @RequirePermissions('customers:read')
  @RequireModulePermission('crm', 'view')
  findOne(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.customersService.findOne(organizationId, id);
  }

  @Post()
  @RequirePermissions('customers:write')
  @RequireModulePermission('crm', 'create')
  create(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCustomerDto,
  ) {
    return this.customersService.create(organizationId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('customers:write')
  @RequireModulePermission('crm', 'edit')
  update(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.update(organizationId, id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('customers:write')
  @RequireModulePermission('crm', 'delete')
  remove(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.customersService.remove(organizationId, id, user.sub);
  }
}
