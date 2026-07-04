import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CompanyId, CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { CreateUserSignatureDto, UpdateUserSignatureDto } from './dto/user-signature.dto';
import { UserSignaturesService } from './user-signatures.service';

@ApiTags('User Signatures')
@ApiBearerAuth()
@Controller('users/:userId/signatures')
export class UserSignaturesController {
  constructor(private readonly userSignaturesService: UserSignaturesService) {}

  @Get()
  @RequirePermissions('user_signatures:view')
  @ApiOperation({ summary: 'List signatures for a user' })
  findAll(
    @Param('userId') userId: string,
    @CompanyId() companyId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.userSignaturesService.findAll(userId, companyId, query);
  }

  @Get(':id')
  @RequirePermissions('user_signatures:view')
  @ApiOperation({ summary: 'Get user signature by ID' })
  findOne(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
  ) {
    return this.userSignaturesService.findOne(userId, companyId, id);
  }

  @Post()
  @RequirePermissions('user_signatures:create')
  @ApiOperation({ summary: 'Create a user signature' })
  create(
    @Param('userId') userId: string,
    @CompanyId() companyId: string,
    @Body() dto: CreateUserSignatureDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userSignaturesService.create(userId, companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('user_signatures:edit')
  @ApiOperation({ summary: 'Update user signature' })
  update(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
    @Body() dto: UpdateUserSignatureDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userSignaturesService.update(userId, companyId, id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('user_signatures:delete')
  @ApiOperation({ summary: 'Delete user signature' })
  remove(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userSignaturesService.remove(userId, companyId, id, user.sub);
  }
}
