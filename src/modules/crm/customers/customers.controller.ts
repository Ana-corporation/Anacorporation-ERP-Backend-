import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import {
  CreateCustomerDto,
  CustomerLookupQueryDto,
  RegistrationLookupQueryDto,
  UpdateCustomerDto,
} from './dto/customer.dto';
import { CustomersService } from './customers.service';

@ApiTags('Customers')
@ApiBearerAuth()
@Controller('companies/:companyId/customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @RequirePermissions('customers:view')
  @ApiOperation({ summary: 'List customers (paginated; rows include primary tax id + default city)' })
  findAll(
    @Param('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.customersService.findAll(companyId, query);
  }

  @Get('lookup')
  @RequirePermissions('customers:view')
  @ApiOperation({ summary: 'Light list for dropdowns (active only, search by code / name)' })
  lookup(
    @Param('companyId') companyId: string,
    @Query() query: CustomerLookupQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.customersService.lookup(companyId, query.search, query.limit);
  }

  @Get('registration-lookup')
  @RequirePermissions('customers:create')
  @ApiOperation({ summary: 'Prefill a new customer from an official registry (GSTIN today)' })
  registrationLookup(
    @Param('companyId') companyId: string,
    @Query() query: RegistrationLookupQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.customersService.registrationLookup(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('customers:view')
  @ApiOperation({ summary: 'Customer detail with tax identifiers, addresses and contacts' })
  findOne(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.customersService.findOne(id, companyId);
  }

  @Post()
  @RequirePermissions('customers:create')
  @ApiOperation({ summary: 'Create a customer (code auto-generated from the CUSTOMER number series when omitted)' })
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateCustomerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.customersService.create(companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('customers:edit')
  @ApiOperation({ summary: 'Update a customer; child arrays, when sent, replace the stored set' })
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.customersService.update(id, companyId, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('customers:delete')
  remove(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.customersService.remove(id, companyId, user.sub);
  }
}
