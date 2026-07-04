import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CompanyId, CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { CreateUserConsentDto, UpdateUserConsentDto } from './dto/user-consent.dto';
import { UserConsentsService } from './user-consents.service';

@ApiTags('User Consents')
@ApiBearerAuth()
@Controller('users/:userId/consents')
export class UserConsentsController {
  constructor(private readonly userConsentsService: UserConsentsService) {}

  @Get()
  @RequirePermissions('user_consents:view')
  @ApiOperation({ summary: 'List consents for a user' })
  findAll(
    @Param('userId') userId: string,
    @CompanyId() companyId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.userConsentsService.findAll(userId, companyId, query);
  }

  @Get(':id')
  @RequirePermissions('user_consents:view')
  @ApiOperation({ summary: 'Get user consent by ID' })
  findOne(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
  ) {
    return this.userConsentsService.findOne(userId, companyId, id);
  }

  @Post()
  @RequirePermissions('user_consents:create')
  @ApiOperation({ summary: 'Record a user consent acceptance' })
  create(
    @Param('userId') userId: string,
    @CompanyId() companyId: string,
    @Body() dto: CreateUserConsentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userConsentsService.create(userId, companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('user_consents:edit')
  @ApiOperation({ summary: 'Update consent record' })
  update(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
    @Body() dto: UpdateUserConsentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userConsentsService.update(userId, companyId, id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('user_consents:delete')
  @ApiOperation({ summary: 'Delete user consent record' })
  remove(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userConsentsService.remove(userId, companyId, id, user.sub);
  }
}
