import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { CurrenciesService } from './currencies.service';
import { CreateCurrencyDto, UpdateCurrencyDto } from './dto/currency.dto';

@ApiTags('Currencies')
@ApiBearerAuth()
@Controller('currencies')
export class CurrenciesController {
  constructor(private readonly currenciesService: CurrenciesService) {}

  @Get()
  @RequirePermissions('currencies:view')
  @ApiOperation({ summary: 'List currencies' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.currenciesService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('currencies:view')
  @ApiOperation({ summary: 'Get currency by ID' })
  findOne(@Param('id') id: string) {
    return this.currenciesService.findOne(id);
  }

  @Post()
  @RequirePermissions('currencies:manage')
  @ApiOperation({ summary: 'Create currency' })
  create(@Body() dto: CreateCurrencyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.currenciesService.create(dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('currencies:manage')
  @ApiOperation({ summary: 'Update currency' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCurrencyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.currenciesService.update(id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('currencies:manage')
  @ApiOperation({ summary: 'Delete currency' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.currenciesService.remove(id, user.sub);
  }
}
