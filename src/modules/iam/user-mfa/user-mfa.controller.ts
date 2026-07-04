import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CompanyId, CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { CreateUserMfaDto, UpdateUserMfaDto } from './dto/user-mfa.dto';
import { UserMfaService } from './user-mfa.service';

@ApiTags('User MFA')
@ApiBearerAuth()
@Controller('users/:userId/mfa')
export class UserMfaController {
  constructor(private readonly userMfaService: UserMfaService) {}

  @Get()
  @RequirePermissions('user_mfa:view')
  @ApiOperation({ summary: 'List MFA methods for a user' })
  findAll(
    @Param('userId') userId: string,
    @CompanyId() companyId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.userMfaService.findAll(userId, companyId, query);
  }

  @Get(':id')
  @RequirePermissions('user_mfa:view')
  @ApiOperation({ summary: 'Get user MFA method by ID' })
  findOne(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
  ) {
    return this.userMfaService.findOne(userId, companyId, id);
  }

  @Post()
  @RequirePermissions('user_mfa:create')
  @ApiOperation({ summary: 'Register an MFA method for a user' })
  create(
    @Param('userId') userId: string,
    @CompanyId() companyId: string,
    @Body() dto: CreateUserMfaDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userMfaService.create(userId, companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('user_mfa:edit')
  @ApiOperation({ summary: 'Update MFA method' })
  update(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
    @Body() dto: UpdateUserMfaDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userMfaService.update(userId, companyId, id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('user_mfa:delete')
  @ApiOperation({ summary: 'Delete user MFA method' })
  remove(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userMfaService.remove(userId, companyId, id, user.sub);
  }
}
